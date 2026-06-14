import { ok, err } from "@hexagen/shared";
import { STAGE_ATTEMPT_TIMEOUT_MS, stageTimeoutError } from "./stage-timeout";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE7_REPAIR_SYSTEM_PROMPT,
  compileStage7Prompt,
} from "../../../domain/index";
import type { ValidationReport } from "../../../domain/value-objects/pipeline-state";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry";

const STAGE_NUMBER = 7;

/** Drop markdown code fences if the model wrapped the config in them. */
function stripCodeFences(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n");
}

/**
 * Stage 7 — GPT-4o verify-and-repair. Optional, gated on the reviewer port
 * (STAGE6_REVIEWER_API_KEY) being wired. Given the original structured config
 * and Stage-6 findings, a stronger model emits a CORRECTED config (same import
 * format). The orchestrator re-runs the deterministic pipeline + Stage 6 on the
 * output to produce a genuine before/after finding count; this use case only
 * produces the corrected config text and never mutates pipeline state itself.
 *
 * Mirrors ExecuteValidationReviewUseCase's streaming / retry / timeout / abort
 * shape so it inherits the same operational behavior.
 */
export class ExecuteManifestRepairUseCase {
  constructor(private readonly reviewerPort: SendStructuredRequestPort) {}

  async execute(
    rawConfig: string,
    report: Pick<ValidationReport, "errors" | "warnings">,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    { success: true; value: string } | { success: false; error: unknown }
  > {
    const stageStart = Date.now();
    const prompt = compileStage7Prompt(rawConfig, report);
    let modelName: string | undefined;
    const errorCount = report.errors.length;
    onChunk?.(
      `Stage 7 · Repairing on the reviewer model — ${errorCount} error${errorCount !== 1 ? "s" : ""} to resolve…`,
    );

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      const retryCount = attempt - 1;
      // Fail fast on the deadline (do not retry a timeout); transient errors
      // below still retry.
      let isTimedOut = false;
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        isTimedOut = true;
        abortController.abort();
      }, STAGE_ATTEMPT_TIMEOUT_MS);

      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE7_REPAIR_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        // A full config is much larger than the Stage-6 findings list, hence a
        // far higher token ceiling. Low temperature: this is a faithful repair,
        // not a creative rewrite.
        { stream: true, temperature: 0.2, maxTokens: 8000 },
      );
      request.signal = abortController.signal;
      request.onModelResolved = (info) => {
        modelName = info.model;
      };

      let fullResponse = "";
      let streamError: unknown = null;
      let chunkCount = 0;

      try {
        const stream = this.reviewerPort.streamStructuredRequest(request);
        for await (const result of stream) {
          if (!result.success) {
            streamError = result.error;
            break;
          }
          fullResponse += result.value;
          chunkCount++;
          if (chunkCount % 50 === 0) {
            onChunk?.(`   Rewriting configuration… (${chunkCount} tokens)`);
          }
        }
      } catch (thrownError) {
        if (isTimedOut) {
          return err(
            stageTimeoutError("Manifest repair", STAGE_ATTEMPT_TIMEOUT_MS),
          );
        }
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            thrownError instanceof Error
              ? thrownError
              : new Error(String(thrownError)),
          );
        }
        continue;
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (streamError) {
        if (isTimedOut) {
          return err(
            stageTimeoutError("Manifest repair", STAGE_ATTEMPT_TIMEOUT_MS),
          );
        }
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(streamError);
        }
        continue;
      }

      const cleaned = stripCodeFences(fullResponse).trim();
      if (cleaned.length === 0) {
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(
            new StageMaxRetriesError(
              STAGE_NUMBER,
              "Repair produced empty output",
              fullResponse,
            ),
          );
        }
        continue;
      }

      const durationMs = Date.now() - stageStart;
      onChunk?.("Stage 7 · Repair complete");
      onStageTelemetry?.({
        stage: STAGE_NUMBER,
        label: "Manifest Repair",
        durationMs,
        usedLLM: true,
        retryCount,
        inputTokensEstimate: estimateTokenCount(prompt),
        outputTokensActual: estimateTokenCount(fullResponse),
        servedFromCache: false,
        summary: `Repaired configuration emitted (${errorCount} error${errorCount !== 1 ? "s" : ""} targeted)`,
        ...(modelName !== undefined ? { modelName } : {}),
      });
      return ok(cleaned);
    }

    throw new Error("Unreachable: all retry paths return within loop");
  }
}
