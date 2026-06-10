import { ok, err } from "@hexagen/shared";
import { STAGE_ATTEMPT_TIMEOUT_MS, stageTimeoutError } from "./stage-timeout";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE6_VALIDATION_SYSTEM_PROMPT,
  compileStage6Prompt,
  validatePortQuality,
  normalizeContextName,
} from "../../../domain/index";
import { isBannedContextName } from "../../../domain/prompts/architecture-contract";
import type {
  ValidationReport,
  PipelineState,
  PortDefinition,
} from "../../../domain/value-objects/pipeline-state";
import type { PortQualityIssue } from "../../../domain/services/port-quality-validator";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry";

const STAGE_NUMBER = 6;

function collectPortQualityIssues(
  state: Pick<PipelineState, "stage0" | "stage1" | "stage3">,
): PortQualityIssue[] {
  const portMap = state.stage3;
  if (!portMap || portMap.contexts.length === 0) return [];

  const runtimeConcerns = state.stage0?.runtimeConcerns;
  const aggregateRoots = state.stage1?.aggregateRoots ?? [];

  const issues: PortQualityIssue[] = [];
  for (const ctx of portMap.contexts) {
    const ctxAggregates = aggregateRoots
      .filter(
        (ar) =>
          normalizeContextName(ar.subdomain) ===
          normalizeContextName(ctx.contextName),
      )
      .map((ar) => ar.name);
    const allPorts: PortDefinition[] = [...ctx.in, ...ctx.out];
    issues.push(
      ...validatePortQuality(
        allPorts,
        ctx.contextName,
        ctxAggregates,
        runtimeConcerns,
      ),
    );
  }
  return issues;
}

export class ExecuteValidationReviewUseCase {
  // No escalationConfig here: only Stage 3 (ExecutePortMappingUseCase) reads
  // its escalation config; the param was a dead copy-paste in stages 0/1/2/4/6.
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<
      PipelineState,
      | "stage0"
      | "stage1"
      | "stage2"
      | "stage3"
      | "stage4"
      | "stage5"
      | "contextMappings"
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
    onChunk?.(
      `Reviewing assembled manifest for DDD violations and consistency issues…`,
    );

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
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
          { role: "system", content: STAGE6_VALIDATION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        { stream: true, temperature: 0.1, maxTokens: 800 },
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
          if (chunkCount % 50 === 0) {
            onChunk?.(`   Scanning for issues… (${chunkCount} tokens)`);
          }
        }
      } catch (thrownError) {
        if (isTimedOut) {
          return err(
            stageTimeoutError("Validation review", STAGE_ATTEMPT_TIMEOUT_MS),
          );
        }
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
        if (isTimedOut) {
          return err(
            stageTimeoutError("Validation review", STAGE_ATTEMPT_TIMEOUT_MS),
          );
        }
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(streamError);
        }
        lastError = `Request error: ${streamError}`;
        continue;
      }

      // Parse NDJSON output — strip markdown code fences first
      const cleanedResponse = fullResponse
        .split("\n")
        .filter((line) => !line.trim().startsWith("```"))
        .join("\n");

      const lines = cleanedResponse
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
              if (Array.isArray(parsed.errors)) {
                for (const e of parsed.errors) {
                  if (typeof e === "string") errors.push(e);
                  else if (e && typeof e.message === "string")
                    errors.push(
                      e.rule ? `[${e.rule}] ${e.message}` : e.message,
                    );
                }
              }
              if (Array.isArray(parsed.warnings)) {
                for (const w of parsed.warnings) {
                  if (typeof w === "string") warnings.push(w);
                  else if (w && typeof w.message === "string")
                    warnings.push(w.message);
                }
              }
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
        // R01 is deterministic (judge-grounding fix, baseline findings F3):
        // the judge prompt no longer carries the banned-token list, so any
        // R01 claim the LLM emits is by construction ungrounded — discard it,
        // then recompute R01 here from the accepted context names. Uses
        // isBannedContextName, so the prose-only "rest" carve-out applies
        // (consistent with the Stage 2 deterministic filter).
        const r01Claim = /\bR01\b/;
        const finalErrors = errors.filter((m) => !r01Claim.test(m));
        const finalWarnings = warnings.filter((m) => !r01Claim.test(m));
        for (const ctx of state.stage2?.accepted ?? []) {
          if (isBannedContextName(ctx.name)) {
            finalErrors.push(
              `[R01] Context '${ctx.name}' violates R01: name contains a banned technology token.`,
            );
          }
        }

        const programmaticIssues = collectPortQualityIssues(state);
        for (const issue of programmaticIssues) {
          const tagged = `[${issue.rule}] ${issue.contextName}/${issue.portName}: ${issue.message}`;
          if (issue.severity === "error") {
            finalErrors.push(tagged);
          } else {
            finalWarnings.push(tagged);
          }
        }
        passed = finalErrors.length === 0;

        const durationMs = Date.now() - stageStart;
        const result: ValidationReport = {
          errors: finalErrors,
          warnings: finalWarnings,
          passed,
        };
        if (passed) {
          onChunk?.(
            `Validation passed — ${finalWarnings.length} warning${finalWarnings.length !== 1 ? "s" : ""}`,
          );
        } else {
          onChunk?.(
            `${finalErrors.length} error${finalErrors.length !== 1 ? "s" : ""} found, ${finalWarnings.length} warning${finalWarnings.length !== 1 ? "s" : ""}`,
          );
        }
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Validation Review",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt),
          outputTokensActual: estimateTokenCount(fullResponse),
          servedFromCache: false,
          summary: `Validation ${passed ? "passed" : "failed"}: ${finalErrors.length} errors, ${finalWarnings.length} warnings`,
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
