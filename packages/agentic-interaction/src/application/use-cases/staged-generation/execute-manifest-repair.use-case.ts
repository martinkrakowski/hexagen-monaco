import { ok, err } from "@hexagen/shared";
import { STAGE_ATTEMPT_TIMEOUT_MS, stageTimeoutError } from "./stage-timeout";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE7_REPAIR_OPS_SYSTEM_PROMPT,
  compileStage7OpsPrompt,
} from "../../../domain/index";
import type { ValidationReport } from "../../../domain/value-objects/pipeline-state";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry";

const STAGE_NUMBER = 7;

/** Drop markdown code fences if the model wrapped the op-list in them. */
function stripCodeFences(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n");
}

/**
 * Stage 7 — GPT-4o verify-and-repair. Optional, gated on the reviewer port
 * (STAGE6_REVIEWER_API_KEY) being wired. Given the assembled MANIFEST and
 * Stage-6 findings, a stronger model emits a small JSON OP-LIST of edits (see
 * STAGE7_REPAIR_OPS_SYSTEM_PROMPT) — NOT a rewritten manifest. The orchestrator
 * applies the ops deterministically (apply-repair-ops) then re-runs the rebuild +
 * Stage 6 for a genuine before/after count; this use case only produces the
 * op-list text and never mutates pipeline state itself. (Follow-up C — see
 * docs/planning/stage7-repair-rca-and-remediation.md §8 — removes the
 * whole-manifest-regeneration failure mode that PR #346 could only soften.)
 *
 * Mirrors ExecuteValidationReviewUseCase's streaming / retry / timeout / abort
 * shape so it inherits the same operational behavior.
 */
export class ExecuteManifestRepairUseCase {
  constructor(private readonly reviewerPort: SendStructuredRequestPort) {}

  async execute(
    manifestYaml: string,
    report: Pick<ValidationReport, "errors" | "warnings">,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    { success: true; value: string } | { success: false; error: unknown }
  > {
    const stageStart = Date.now();
    const prompt = compileStage7OpsPrompt(manifestYaml, report);
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
        // Placeholder DomainModelId (a required positional arg of
        // createLLMRequest). The SERVED model is resolved by the reviewer
        // port's fallback chain, NOT by this id: createStage6ReviewerConfig
        // wires gpt-4o with preferLocal:false + webLlmAdapter:null, so the
        // LLMProviderSelectorAdapter routes straight to its cloud chain and the
        // id is never consulted. Same placeholder convention as Stage 6
        // (ExecuteValidationReviewUseCase), which serves mercury-2 in prod
        // despite passing this exact id.
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE7_REPAIR_OPS_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        // The output is a small JSON op-list (a handful of edits), not a whole
        // manifest. Truncation is all-or-nothing (a cut-off array fails to parse
        // → 0 ops, original kept), so the ceiling is sized for a worst-case
        // many-finding spec (pretty-printed) with margin. Low temperature:
        // faithful repair, not a creative rewrite.
        { stream: true, temperature: 0.2, maxTokens: 4000 },
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
            onChunk?.(`   Planning repair edits… (${chunkCount} tokens)`);
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
        summary: `Repair edits emitted (${errorCount} finding${errorCount !== 1 ? "s" : ""} targeted)`,
        ...(modelName !== undefined ? { modelName } : {}),
      });
      return ok(cleaned);
    }

    throw new Error("Unreachable: all retry paths return within loop");
  }
}
