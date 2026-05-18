import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE0_NORMALIZATION_SYSTEM_PROMPT,
  compileStage0Prompt,
} from "../../../domain/index.js";
import type { NormalizedPrompt } from "../../../domain/value-objects/pipeline-state.js";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt.js";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt.js";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors.js";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry.js";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry.js";

const STAGE_NUMBER = 0;

export class ExecutePromptNormalizationUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    userDescription: string,
    variables?: PromptVariables,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    | { success: true; value: NormalizedPrompt }
    | { success: false; error: unknown }
  > {
    const stageStart = Date.now();
    let prompt = compileStage0Prompt(variables || { userDescription });
    let lastError = "";
    let retryCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE0_NORMALIZATION_SYSTEM_PROMPT },
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
        const errorMsg = `Request error: ${streamError}`;
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            new StageMaxRetriesError(STAGE_NUMBER, errorMsg, fullResponse),
          );
        }
        lastError = errorMsg;
        continue;
      }

      // Parse NDJSON output
      const lines = fullResponse
        .split("\n")
        .filter((line) => line.trim() !== "");
      let intent = "";
      const explicitTechnologies: string[] = [];
      const explicitPatterns: string[] = [];
      const ambiguities: string[] = [];
      let hasValidLine = false;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          hasValidLine = true;
          if (parsed.type === "intent") {
            intent = parsed.value;
          } else if (parsed.type === "technology") {
            explicitTechnologies.push(parsed.value);
          } else if (parsed.type === "pattern") {
            explicitPatterns.push(parsed.value);
          } else if (parsed.type === "ambiguity") {
            ambiguities.push(parsed.value);
          }
        } catch {
          // Ignore malformed lines
        }
      }

      // Validate output
      const parseError = !hasValidLine
        ? "No valid NDJSON lines found in output"
        : !intent
          ? "Missing required 'intent' object in output"
          : "";

      if (!parseError) {
        const durationMs = Date.now() - stageStart;
        const result = {
          intent,
          explicitTechnologies,
          explicitPatterns,
          ambiguities,
        };
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Prompt Normalization",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt),
          outputTokensActual: estimateTokenCount(fullResponse),
          servedFromCache: false,
          summary: `Normalized intent: ${intent}, ${explicitTechnologies.length} technologies, ${ambiguities.length} ambiguities`,
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

    // Should never reach here
    return err(new StageMaxRetriesError(STAGE_NUMBER, lastError, ""));
  }
}
