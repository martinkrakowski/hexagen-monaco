import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE6_VALIDATION_SYSTEM_PROMPT,
  compileStage6Prompt,
} from "../../../domain/index.js";
import type {
  ValidationReport,
  PipelineState,
} from "../../../domain/value-objects/pipeline-state.js";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt.js";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors.js";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry.js";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry.js";

const STAGE_NUMBER = 6;

export class ExecuteValidationReviewUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<
      PipelineState,
      "stage0" | "stage2" | "stage5" | "contextMappings"
    >,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    | { success: true; value: ValidationReport }
    | { success: false; error: unknown }
  > {
    const stageStart = Date.now();
    let prompt = compileStage6Prompt(state);
    let lastError = "";
    let retryCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE6_VALIDATION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        { stream: true, temperature: 0.1, maxTokens: 800 },
      );

      const stream = this.llmPort.streamStructuredRequest(request);
      let fullResponse = "";
      let streamError: unknown = null;

      for await (const chunkResult of stream) {
        if (!chunkResult.success) {
          streamError = chunkResult.error;
          break;
        }
        const chunkData =
          typeof chunkResult.value === "string"
            ? chunkResult.value
            : (chunkResult.value as { content?: string })?.content || "";
        fullResponse += chunkData;
        if (onChunk && chunkData) {
          onChunk(chunkData);
        }
      }

      if (streamError) {
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(streamError);
        }
        lastError = `Stream error: ${streamError}`;
        continue;
      }

      // Parse NDJSON output
      const lines = fullResponse
        .split("\n")
        .filter((line) => line.trim() !== "");
      const errors: string[] = [];
      const warnings: string[] = [];
      let passed = false;
      let hasValidLine = false;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (
            parsed.type === "error" ||
            parsed.type === "warning" ||
            parsed.type === "result"
          ) {
            hasValidLine = true;
            if (parsed.type === "error") {
              errors.push(parsed.message);
            } else if (parsed.type === "warning") {
              warnings.push(parsed.message);
            } else if (parsed.type === "result") {
              passed = errors.length === 0;
            }
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
        const result: ValidationReport = { errors, warnings, passed };
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Validation Review",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt),
          outputTokensActual: estimateTokenCount(fullResponse),
          servedFromCache: false,
          summary: `Validation ${passed ? "passed" : "failed"}: ${errors.length} errors, ${warnings.length} warnings`,
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

    throw new Error("Unreachable: all retry paths return within loop");
  }
}
