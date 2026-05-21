import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE4_ADAPTERS_SYSTEM_PROMPT,
  compileStage4Prompt,
} from "../../../domain/index";
import type {
  AdapterBinding,
  AdapterBindings,
  PipelineState,
  ContextAdapters,
} from "../../../domain/value-objects/pipeline-state";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry";
import { DEFAULT_ESCALATION_CONFIG } from "./retry-with-escalation";
import type { EscalationConfig } from "./retry-with-escalation";

const STAGE_NUMBER = 4;

/**
 * Brace-depth scanner: correctly extracts JSON objects from LLM output
 * regardless of whether they are newline-separated, concatenated, or wrapped
 * in markdown fences. Handles `{` and `}` inside string values correctly.
 */
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
            JSON.parse(stripped.slice(start, i + 1)) as Record<string, unknown>,
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

export class ExecuteAdapterAssignmentUseCase {
  constructor(
    private readonly llmPort: SendStructuredRequestPort,
    private readonly escalationConfig: EscalationConfig = DEFAULT_ESCALATION_CONFIG,
  ) {}

  async execute(
    state: Pick<
      PipelineState,
      "stage0" | "stage2" | "stage3" | "contextMappings"
    >,
    variables: PromptVariables,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    | { success: true; value: AdapterBindings }
    | { success: false; error: unknown }
  > {
    const stageStart = Date.now();
    let prompt = compileStage4Prompt(state, variables);
    let lastError = "";
    let retryCount = 0;
    const contextCount = state.stage2?.accepted?.length ?? 0;
    onChunk?.(
      `Assigning concrete adapters across ${contextCount} bounded contexts…`,
    );

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), 1800000); // 30min timeout per attempt

      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE4_ADAPTERS_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        { stream: true, temperature: 0.1, maxTokens: 4096 },
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
            onChunk?.(`   Writing adapter bindings… (${chunkCount} tokens)`);
          }
        }
      } catch (thrownError) {
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            thrownError instanceof Error
              ? thrownError
              : new Error(String(thrownError)),
          );
        }
        lastError = `Request error: ${thrownError instanceof Error ? thrownError.message : String(thrownError)}`;
        continue;
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (streamError) {
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(streamError);
        }
        lastError = `Request error: ${streamError}`;
        continue;
      }

      const VALID_ADAPTER_TYPES = new Set<string>([
        "Repository",
        "Listener",
        "Publisher",
        "HttpClient",
        "Notifier",
        "Controller",
      ]);

      const objects = extractJsonObjects(fullResponse);
      const contextAdaptersMap = new Map<
        string,
        Array<{
          name: string;
          type: string;
          implements: string;
          adapterType?: AdapterBinding["adapterType"];
          technology?: string;
        }>
      >();

      for (const parsed of objects) {
        // Support both {"adapter": {...}} wrapper and flat {"contextName": ...}
        const entry = (
          parsed.adapter != null && typeof parsed.adapter === "object"
            ? parsed.adapter
            : parsed
        ) as Record<string, unknown>;

        const contextName =
          typeof entry.contextName === "string" ? entry.contextName : "";
        // The system prompt uses "name" for the adapter name
        const adapterName = typeof entry.name === "string" ? entry.name : "";
        const adapterType =
          typeof entry.adapterType === "string" ? entry.adapterType : "";
        const technology =
          typeof entry.technology === "string" ? entry.technology : undefined;
        const impl =
          typeof entry.implements === "string" ? entry.implements : "";

        if (!contextName || !adapterName || !adapterType || !impl) continue;

        if (!contextAdaptersMap.has(contextName)) {
          contextAdaptersMap.set(contextName, []);
        }

        const binding: {
          name: string;
          type: string;
          implements: string;
          adapterType?: AdapterBinding["adapterType"];
          technology?: string;
        } = {
          name: adapterName,
          type: adapterType,
          implements: impl,
        };

        if (VALID_ADAPTER_TYPES.has(adapterType)) {
          binding.adapterType = adapterType as AdapterBinding["adapterType"];
        }

        if (technology && technology.length > 0) {
          binding.technology = technology;
        }

        contextAdaptersMap.get(contextName)!.push(binding);
      }

      const parseError =
        objects.length === 0 ? "No valid JSON objects found in output" : "";

      if (!parseError) {
        const durationMs = Date.now() - stageStart;
        const contexts: ContextAdapters[] = [];
        for (const [contextName, adapters] of contextAdaptersMap.entries()) {
          contexts.push({ contextName, adapters });
        }
        const result: AdapterBindings = { contexts };
        const totalAdapters = contexts.reduce(
          (sum, c) => sum + c.adapters.length,
          0,
        );
        onChunk?.(
          `   ✓ ${totalAdapters} adapters assigned across ${contexts.length} contexts`,
        );
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Adapter Assignment",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt),
          outputTokensActual: estimateTokenCount(fullResponse),
          servedFromCache: false,
          summary: `Assigned adapters for ${contexts.length} contexts`,
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
