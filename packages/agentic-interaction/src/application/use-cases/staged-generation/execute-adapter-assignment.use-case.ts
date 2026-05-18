import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE4_ADAPTERS_SYSTEM_PROMPT,
  compileStage4Prompt,
} from "../../../domain/index.js";
import type {
  AdapterBinding,
  AdapterBindings,
  PipelineState,
  ContextAdapters,
} from "../../../domain/value-objects/pipeline-state.js";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt.js";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt.js";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors.js";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry.js";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry.js";

const STAGE_NUMBER = 4;

export class ExecuteAdapterAssignmentUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

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

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), 5000); // 5s timeout per attempt

      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE4_ADAPTERS_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        { stream: true, temperature: 0.1, maxTokens: 800 },
      );
      request.signal = abortController.signal;

      let responseResult;
      try {
        responseResult = await this.llmPort.sendRequest(request);
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
      const VALID_ADAPTER_TYPES = new Set<string>([
        "Repository",
        "Listener",
        "Publisher",
        "HttpClient",
        "Notifier",
        "Controller",
      ]);

      const lines = fullResponse
        .split("\n")
        .filter((line) => line.trim() !== "");
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
      let hasValidLine = false;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          hasValidLine = true;
          const entry = parsed.adapter ?? parsed;
          const {
            contextName,
            adapterName,
            adapterType,
            technology,
            implements: impl,
          } = entry;

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

          if (
            typeof adapterType === "string" &&
            VALID_ADAPTER_TYPES.has(adapterType)
          ) {
            binding.adapterType = adapterType as AdapterBinding["adapterType"];
          }

          if (typeof technology === "string" && technology.length > 0) {
            binding.technology = technology;
          }

          contextAdaptersMap.get(contextName)!.push(binding);
        } catch {
          // Ignore malformed lines
        }
      }

      const parseError = !hasValidLine
        ? "No valid NDJSON lines found in output"
        : "";

      if (!parseError) {
        const durationMs = Date.now() - stageStart;
        const contexts: ContextAdapters[] = [];
        for (const [contextName, adapters] of contextAdaptersMap.entries()) {
          contexts.push({ contextName, adapters });
        }
        const result: AdapterBindings = { contexts };
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
