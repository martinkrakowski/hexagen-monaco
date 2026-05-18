import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE3_PORTS_SYSTEM_PROMPT,
  compileStage3Prompt,
} from "../../../domain/index.js";
import type {
  PortMap,
  PipelineState,
  ContextPorts,
  PortDefinition,
  InboundPortType,
  OutboundPortType,
  ContextMappingEntry,
} from "../../../domain/value-objects/pipeline-state.js";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt.js";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors.js";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry.js";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry.js";

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

export class ExecutePortMappingUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<PipelineState, "stage0" | "stage1" | "stage2">,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    | { success: true; value: PortMappingResult }
    | { success: false; error: unknown }
  > {
    const stageStart = Date.now();
    let prompt = compileStage3Prompt(state);
    let lastError = "";
    let retryCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE3_PORTS_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        { stream: true, temperature: 0.1, maxTokens: 800 },
      );

      const responseResult = await this.llmPort.sendRequest(request);
      let fullResponse = "";
      let streamError: unknown = null;

      if (!responseResult.success) {
        streamError = responseResult.error;
      } else {
        fullResponse = responseResult.value.content;
        if (onChunk && fullResponse) {
          onChunk(fullResponse);
        }
      }

      if (streamError) {
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(streamError);
        }
        lastError = `Request error: ${streamError}`;
        continue;
      }

      // Parse NDJSON output
      const lines = fullResponse
        .split("\n")
        .filter((line) => line.trim() !== "");
      const contextPortsMap = new Map<
        string,
        { in: PortDefinition[]; out: PortDefinition[] }
      >();
      const contextMappings: ContextMappingEntry[] = [];
      let hasValidLine = false;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          hasValidLine = true;
          const entryType = parsed.type || "port";

          if (entryType === "contextMapping") {
            if (
              typeof parsed.upstream === "string" &&
              typeof parsed.downstream === "string"
            ) {
              const mapping: ContextMappingEntry = {
                upstream: parsed.upstream,
                downstream: parsed.downstream,
              };
              if (typeof parsed.pattern === "string")
                mapping.pattern = parsed.pattern;
              if (typeof parsed.mechanism === "string")
                mapping.mechanism = parsed.mechanism;
              if (typeof parsed.notes === "string")
                mapping.notes = parsed.notes;
              if (
                Array.isArray(parsed.events) &&
                parsed.events.every((v: unknown) => typeof v === "string")
              ) {
                mapping.events = parsed.events;
              }
              contextMappings.push(mapping);
            }
            continue;
          }

          const { contextName, direction, name, portType, description } =
            parsed;

          if (!contextName || !direction || !name || !portType) continue;

          if (!contextPortsMap.has(contextName)) {
            contextPortsMap.set(contextName, { in: [], out: [] });
          }

          const ports = contextPortsMap.get(contextName)!;
          const coercedType = coercePortType(direction, portType);
          if (!coercedType) continue;

          const portDef: PortDefinition = {
            name,
            type: coercedType as InboundPortType | OutboundPortType,
            description: description || "",
          };
          if (typeof parsed.forAggregate === "string") {
            portDef.forAggregate = parsed.forAggregate;
          }

          if (direction === "in") {
            portDef.type = coercedType as InboundPortType;
            ports.in.push(portDef);
          } else if (direction === "out") {
            portDef.type = coercedType as OutboundPortType;
            ports.out.push(portDef);
          }
        } catch {
          // Ignore malformed lines
        }
      }

      const parseError = !hasValidLine
        ? "No valid NDJSON lines found in output"
        : "";

      if (!parseError) {
        const durationMs = Date.now() - stageStart;
        const contexts: ContextPorts[] = [];
        for (const [contextName, ports] of contextPortsMap.entries()) {
          contexts.push({ contextName, in: ports.in, out: ports.out });
        }
        const result: PortMappingResult = {
          portMap: { contexts },
          contextMappings,
        };
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Port Mapping",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt),
          outputTokensActual: estimateTokenCount(fullResponse),
          servedFromCache: false,
          summary: `Mapped ports for ${contexts.length} contexts, ${contextMappings.length} context mappings`,
        });
        return ok(result);
      }

      lastError = parseError;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        return err(
          new StageMaxRetriesError(STAGE_NUMBER, lastError, fullResponse),
        );
      }

      // Build retry prompt
      prompt = buildStageRetryPrompt({
        stage: STAGE_NUMBER,
        attempt: attempt + 1,
        failedOutput: fullResponse,
        errorDetail: parseError,
        originalPrompt: prompt,
      }).content;
    }

    return err(new StageMaxRetriesError(STAGE_NUMBER, lastError, ""));
  }
}
