import { ok } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE3_PORTS_SYSTEM_PROMPT,
  compileStage3Prompt,
  normalizeContextName,
} from "../../../domain/index";
import type {
  PortMap,
  PipelineState,
  ContextPorts,
  PortDefinition,
  InboundPortType,
  OutboundPortType,
  ContextMappingEntry,
  ClassifiedContext,
  AggregateRoot,
  DomainEvent,
} from "../../../domain/value-objects/pipeline-state";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry";

const STAGE_NUMBER = 3;

const VALID_INBOUND_TYPES = new Set<string>(["command", "query", "event"]);
const VALID_OUTBOUND_TYPES = new Set<string>([
  "repository",
  "publisher",
  "external-client",
  "notifier",
]);

function coercePortType(
  direction: string,
  raw: string,
): InboundPortType | OutboundPortType | null {
  if (direction === "in") {
    return VALID_INBOUND_TYPES.has(raw) ? (raw as InboundPortType) : "command";
  }
  if (direction === "out") {
    return VALID_OUTBOUND_TYPES.has(raw)
      ? (raw as OutboundPortType)
      : "repository";
  }
  return null;
}

export interface PortMappingResult {
  portMap: PortMap;
  contextMappings: ContextMappingEntry[];
}

type StageState = Required<Pick<PipelineState, "stage0" | "stage1" | "stage2">>;

/**
 * Find matching context name in accepted contexts, accounting for format variations.
 */
function findMatchingContextName(
  inputName: string,
  acceptedContextNames: Map<string, string>,
): string | undefined {
  const normalized = normalizeContextName(inputName);
  for (const [key] of acceptedContextNames.entries()) {
    if (normalizeContextName(key) === normalized) {
      return key;
    }
  }
  return undefined;
}

function filterStateForContext(
  state: StageState,
  contextName: string,
): StageState {
  const normalCtx = normalizeContextName(contextName);
  const aggregateRoots: AggregateRoot[] = (
    state.stage1.aggregateRoots ?? []
  ).filter((ar) => normalizeContextName(ar.subdomain) === normalCtx);
  const domainEvents: DomainEvent[] = (state.stage1.domainEvents ?? []).filter(
    (d) => normalizeContextName(d.emitter) === normalCtx,
  );
  const useCases = (state.stage1.useCases ?? []).filter(
    (uc) => normalizeContextName(uc.subdomain) === normalCtx,
  );

  const accepted: ClassifiedContext[] = state.stage2.accepted.filter(
    (c) => c.name === contextName,
  );

  return {
    stage0: state.stage0,
    stage1: {
      ...state.stage1,
      aggregateRoots,
      domainEvents,
      useCases,
    },
    stage2: {
      ...state.stage2,
      accepted,
    },
  };
}

function extractJsonObjects(raw: string): Record<string, unknown>[] {
  const stripped = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!stripped) return [];

  const results: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          results.push(
            normalizeKeys(
              JSON.parse(stripped.slice(start, i + 1)) as Record<
                string,
                unknown
              >,
            ),
          );
        } catch {
          // skip malformed object
        }
        start = -1;
      }
    }
  }

  return results;
}

function normalizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.trim()] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

export class ExecutePortMappingUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: StageState,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    | { success: true; value: PortMappingResult }
    | { success: false; error: unknown }
  > {
    const stageStart = Date.now();
    const allPortsMap = new Map<
      string,
      { in: PortDefinition[]; out: PortDefinition[] }
    >();
    const allContextMappings: ContextMappingEntry[] = [];
    let totalRetryCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const contexts = state.stage2.accepted;
    if (!contexts || contexts.length === 0) {
      return ok({ portMap: { contexts: [] }, contextMappings: [] });
    }

    console.log(
      `[Stage 3] Starting port mapping for ${contexts.length} contexts`,
    );
    onChunk?.(
      `Analyzing ${contexts.length} bounded contexts for hexagonal ports…`,
    );

    // Build maps of valid context names (both PascalCase and normalized forms)
    const acceptedContextNames = new Map(contexts.map((c) => [c.name, c.name]));

    for (const [idx, context] of contexts.entries()) {
      onChunk?.(
        `→ ${context.name} (${idx + 1} of ${contexts.length}) — identifying inbound commands, queries, events and outbound repositories, publishers`,
      );
      const filtered = filterStateForContext(state, context.name);
      const prompt = compileStage3Prompt(filtered);
      totalInputTokens += estimateTokenCount(prompt);

      const result = await this.runLLMWithRetry(prompt, onChunk);
      totalRetryCount += result.retryCount;
      totalOutputTokens += estimateTokenCount(result.fullResponse);
      const retryNote =
        result.retryCount > 0 ? `, retried ${result.retryCount}×` : "";
      onChunk?.(
        `   ✓ ${result.objects.length} port definitions identified${retryNote}`,
      );

      const { portsMap, mappings } = this.extractPortsAndMappings(
        result.objects,
        context.name,
        acceptedContextNames,
      );

      for (const [ctxName, ports] of portsMap.entries()) {
        allPortsMap.set(ctxName, ports);
      }
      allContextMappings.push(...mappings);
    }

    console.log(
      `[Stage 3] Completed all contexts. Total retries: ${totalRetryCount}`,
    );
    const durationMs = Date.now() - stageStart;
    const contextsArray: ContextPorts[] = [];
    for (const [contextName, ports] of allPortsMap.entries()) {
      contextsArray.push({ contextName, in: ports.in, out: ports.out });
    }

    onStageTelemetry?.({
      stage: STAGE_NUMBER,
      label: "Port Mapping",
      durationMs,
      usedLLM: true,
      retryCount: totalRetryCount,
      inputTokensEstimate: totalInputTokens,
      outputTokensActual: totalOutputTokens,
      servedFromCache: false,
      summary: `Mapped ports for ${contextsArray.length} contexts, ${allContextMappings.length} context mappings`,
    });

    return ok({
      portMap: { contexts: contextsArray },
      contextMappings: allContextMappings,
    });
  }

  private async runLLMWithRetry(
    initialPrompt: string,
    onChunk?: (chunk: string) => void,
  ): Promise<{
    objects: Record<string, unknown>[];
    fullResponse: string;
    retryCount: number;
  }> {
    let prompt = initialPrompt;
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      const retryCount = attempt - 1;
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        console.log(`[Stage 3] Attempt ${attempt} timed out after 120s`);
        onChunk?.(
          `   ⏱ Attempt ${attempt} timed out — using partial output if available`,
        );
        abortController.abort();
      }, 120000);

      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE3_PORTS_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        { stream: true, temperature: 0.3, maxTokens: 768 },
      );
      request.signal = abortController.signal;

      let fullResponse = "";
      let streamError: unknown = null;
      let chunkCount = 0;

      try {
        const stream = this.llmPort.streamStructuredRequest(request);
        for await (const result of stream) {
          if (!result.success) {
            streamError = result.error;
            break;
          }
          fullResponse += result.value;
          chunkCount++;
          if (chunkCount % 100 === 0) {
            console.log(
              `[Stage 3] Attempt ${attempt}: ${chunkCount} chunks received`,
            );
            onChunk?.(`   Generating port definitions… (${chunkCount} tokens)`);
          }
        }
      } catch (thrownError) {
        const partialObjects = extractJsonObjects(fullResponse);
        if (partialObjects.length > 0) {
          console.log(
            `[Stage 3] Using ${partialObjects.length} partial objects after throw on attempt ${attempt} (${chunkCount} chunks)`,
          );
          return { objects: partialObjects, fullResponse, retryCount };
        }
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return { objects: [], fullResponse, retryCount };
        }
        lastError = `Request error: ${thrownError instanceof Error ? thrownError.message : String(thrownError)}`;
        onChunk?.(`\n--- Retry ${attempt + 1} (stream error) ---\n`);
        continue;
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (streamError) {
        // On abort/timeout, accept any valid partial objects rather than retrying
        const partialObjects = extractJsonObjects(fullResponse);
        if (partialObjects.length > 0) {
          console.log(
            `[Stage 3] Using ${partialObjects.length} partial objects after timeout on attempt ${attempt} (${chunkCount} chunks)`,
          );
          return { objects: partialObjects, fullResponse, retryCount };
        }
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return { objects: [], fullResponse, retryCount };
        }
        lastError = `Request error: ${streamError}`;
        console.log(
          `[Stage 3] Attempt ${attempt} stream error, retrying... (${chunkCount} chunks)`,
        );
        onChunk?.(
          `   ↻ Retrying… (attempt ${attempt + 1} of ${MAX_RETRY_ATTEMPTS})`,
        );
        continue;
      }

      console.log(
        `[Stage 3] Attempt ${attempt} completed (${chunkCount} chunks)`,
      );

      const objects = extractJsonObjects(fullResponse);
      if (objects.length > 0) {
        return { objects, fullResponse, retryCount };
      }

      lastError = "No valid JSON objects found in output";
      if (attempt === MAX_RETRY_ATTEMPTS) {
        return { objects: [], fullResponse, retryCount };
      }
      onChunk?.(`\n--- Retry ${attempt + 1} (parse failed) ---\n`);

      prompt = buildStageRetryPrompt({
        stage: STAGE_NUMBER,
        attempt: attempt + 1,
        failedOutput: fullResponse,
        errorDetail: lastError,
        originalPrompt: initialPrompt,
      }).content;
    }

    return {
      objects: [],
      fullResponse: "",
      retryCount: MAX_RETRY_ATTEMPTS - 1,
    };
  }

  private extractPortsAndMappings(
    objects: Record<string, unknown>[],
    fallbackContextName: string,
    acceptedContextNames: Map<string, string>,
  ): {
    portsMap: Map<string, { in: PortDefinition[]; out: PortDefinition[] }>;
    mappings: ContextMappingEntry[];
  } {
    const portsMap = new Map<
      string,
      { in: PortDefinition[]; out: PortDefinition[] }
    >();
    const mappings: ContextMappingEntry[] = [];

    for (const normalized of objects) {
      const entryType = String(normalized.type ?? "port");

      if (entryType === "contextMapping" || entryType === "context-mapping") {
        const upstream = String(normalized.upstream ?? "");
        const downstream = String(normalized.downstream ?? "");

        // Resolve context names accounting for format variations (PascalCase, kebab-case, etc.)
        const resolvedUpstream = findMatchingContextName(
          upstream,
          acceptedContextNames,
        );
        const resolvedDownstream = findMatchingContextName(
          downstream,
          acceptedContextNames,
        );

        // Validate that both upstream and downstream refer to accepted contexts
        if (!resolvedUpstream || !resolvedDownstream) {
          // Skip mapping if either context doesn't exist — this prevents hallucinated mappings
          continue;
        }

        if (resolvedUpstream && resolvedDownstream) {
          const mapping: ContextMappingEntry = {
            upstream: resolvedUpstream,
            downstream: resolvedDownstream,
          };
          if (typeof normalized.pattern === "string")
            mapping.pattern = normalized.pattern;
          if (typeof normalized.mechanism === "string")
            mapping.mechanism = normalized.mechanism;
          if (typeof normalized.notes === "string")
            mapping.notes = normalized.notes;
          if (
            Array.isArray(normalized.events) &&
            normalized.events.every((v: unknown) => typeof v === "string")
          ) {
            mapping.events = normalized.events as string[];
          }
          mappings.push(mapping);
        }
        continue;
      }

      const inputContextName = String(
        normalized.contextName ??
          normalized["context Name"] ??
          fallbackContextName,
      );

      // Resolve the context name to the canonical form
      const contextName =
        findMatchingContextName(inputContextName, acceptedContextNames) ||
        inputContextName;

      const direction = String(normalized.direction ?? "");
      const name = String(normalized.name ?? "");
      const portType = String(normalized.portType ?? "");
      const description = String(normalized.description ?? "");

      if (!direction || !name || !portType) continue;
      if (direction !== "in" && direction !== "out") continue;

      const coercedType = coercePortType(direction, portType);
      if (!coercedType) continue;

      if (!portsMap.has(contextName)) {
        portsMap.set(contextName, { in: [], out: [] });
      }

      const portDef: PortDefinition = {
        name,
        type: coercedType as InboundPortType | OutboundPortType,
        description,
      };
      if (typeof normalized.forAggregate === "string") {
        portDef.forAggregate = normalized.forAggregate;
      }

      const ports = portsMap.get(contextName)!;
      if (direction === "in") {
        ports.in.push(portDef);
      } else {
        ports.out.push(portDef);
      }
    }

    return { portsMap, mappings };
  }
}
