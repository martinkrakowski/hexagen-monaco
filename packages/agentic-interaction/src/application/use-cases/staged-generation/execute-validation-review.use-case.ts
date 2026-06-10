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
            // Tag every finding with its rule id (same `[Rxx] message` shape
            // as the programmatic port-quality issues): the rule must survive
            // into the stored string or the R01 discard below can't see it —
            // per the prompt's exemplars, message text alone rarely names
            // the rule.
            const tagWithRule = (rule: unknown, message: string): string =>
              typeof rule === "string" && rule
                ? `[${rule}] ${message}`
                : message;
            if (parsed.type === "error") {
              errors.push(tagWithRule(parsed.rule, parsed.message));
            } else if (parsed.type === "warning") {
              warnings.push(tagWithRule(parsed.rule, parsed.message));
            } else if (parsed.type === "result") {
              if (Array.isArray(parsed.errors)) {
                for (const e of parsed.errors) {
                  if (typeof e === "string") errors.push(e);
                  else if (e && typeof e.message === "string")
                    errors.push(tagWithRule(e.rule, e.message));
                }
              }
              if (Array.isArray(parsed.warnings)) {
                for (const w of parsed.warnings) {
                  if (typeof w === "string") warnings.push(w);
                  else if (w && typeof w.message === "string")
                    warnings.push(tagWithRule(w.rule, w.message));
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
        // R01 and the port-quality rules R16/R17/R18 are deterministic:
        // - R01 (judge-grounding fix, baseline findings F3): the judge prompt
        //   no longer carries the banned-token list, so any R01 claim the LLM
        //   emits is by construction ungrounded — discard it, then recompute
        //   R01 here from the accepted context names. Uses isBannedContextName,
        //   so the prose-only "rest" carve-out applies (consistent with the
        //   Stage 2 deterministic filter).
        // - R16/R17/R18: collectPortQualityIssues below recomputes them
        //   exactly (validatePortQuality, including the runtime-concern leak
        //   net — runtimeConcerns is passed), so any LLM claim for these
        //   rules is at best a duplicate that double-counts the finding and
        //   at worst a contradiction of the deterministic source (observed in
        //   the 2026-06-10 model sweep: LLM R17s on every model alongside the
        //   programmatic ones). The deterministic result is the sole source.
        // Two-tier discard, keyed on the finding's OWN rule:
        // - Tagged findings (`[Rxx] …` from parse-time tagging) are judged by
        //   their leading tag alone — an [R02] finding whose message text
        //   merely *mentions* R17 is not an R17 claim and must survive.
        // - Untagged findings (the tolerated bare-string shape in
        //   result.errors/warnings, or objects missing a rule field) have no
        //   tag to anchor on; there, a deterministic-rule mention anywhere in
        //   the prose is the best available evidence the claim is one of the
        //   recomputed rules, so the broad scan applies as fallback. An
        //   untagged deterministic claim that never names its rule is
        //   undetectable by construction — bounded harm: it duplicates (or
        //   contradicts) the programmatic recomputation below, which was the
        //   universal pre-discard status quo.
        // Case-insensitive throughout in case the model lowercases rule ids.
        const leadingRuleTag = /^\[(R\d{2})\]/i;
        const deterministicRule = /^R(?:01|16|17|18)$/i;
        const deterministicMention = /\bR(?:01|16|17|18)\b/i;
        const isDeterministicClaim = (m: string): boolean => {
          const tag = leadingRuleTag.exec(m);
          if (tag) return deterministicRule.test(tag[1] as string);
          return deterministicMention.test(m);
        };
        const finalErrors = errors.filter((m) => !isDeterministicClaim(m));
        const finalWarnings = warnings.filter((m) => !isDeterministicClaim(m));
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
