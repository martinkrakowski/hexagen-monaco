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
  normalizePortName,
} from "../../../domain/index";
import { bannedTokensInContextName } from "../../../domain/prompts/architecture-contract";
import { portAdapterCoverageErrors } from "../../../domain/manifest/port-adapter-coverage";
import type {
  ValidationReport,
  PipelineState,
  PortDefinition,
} from "../../../domain/value-objects/pipeline-state";
import type { PortQualityIssue } from "../../../domain/services/port-quality-validator";
import { buildStage6RetryPrompt } from "../../../domain/prompts/generate-manifest.prompt";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import {
  estimateTokenCount,
  stageSummary,
} from "../../../domain/value-objects/stage-telemetry";

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

/** Dedicated reviewer for Stage 6 — a separate model AND token budget from the
 * main pipeline LLM. A reasoning reviewer (e.g. nemotron-3-ultra) measured 0
 * false positives where mercury-2 returns empty, but needs a larger budget than
 * mercury's 800. `maxTokens` is REQUIRED: a dedicated reasoning reviewer left at
 * the 800 default would truncate before the NDJSON result line — the exact
 * failure this reviewer exists to prevent — so configuring one means stating its
 * budget. Off ⇒ Stage 6 runs on the main pipeline model at 800, unchanged. */
export interface Stage6ReviewerConfig {
  port: SendStructuredRequestPort;
  maxTokens: number;
}

export class ExecuteValidationReviewUseCase {
  // No escalationConfig here: only Stage 3 (ExecutePortMappingUseCase) reads
  // its escalation config; the param was a dead copy-paste in stages 0/1/2/4/6.
  constructor(
    private readonly llmPort: SendStructuredRequestPort,
    /** Output-token ceiling for the review request. Default 800 (mercury's
     * working budget). A reasoning reviewer MUST raise this: its reasoning
     * tokens count against the completion budget, so at 800 it truncates before
     * the NDJSON result line (measured — nemotron needs ~3–4k). */
    private readonly maxTokens: number = 800,
  ) {}

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
    const originalPrompt = compileStage6Prompt(state);
    let prompt = originalPrompt;
    let lastError = "";
    let retryCount = 0;
    let modelName: string | undefined;
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
        { stream: true, temperature: 0.1, maxTokens: this.maxTokens },
      );
      request.signal = abortController.signal;
      // Last-write-wins across retry attempts: each attempt builds a fresh
      // request, and the streaming adapter fires this on the first parsed
      // frame of whichever provider actually streams — so any attempt that
      // produced content re-fires it, and the winning attempt's value is
      // what the success telemetry below reports.
      request.onModelResolved = (info) => {
        modelName = info.model;
      };

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
        //   R01 here from the accepted context names. Uses
        //   bannedTokensInContextName (same token set as isBannedContextName, so
        //   the prose-only "rest" carve-out applies, consistent with the Stage 2
        //   deterministic filter) — naming the offending token(s) so the finding
        //   is actionable.
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
        // R04/R05 join the discard set ONLY when the deterministic per-context
        // recompute below can run (stage3 + stage4 present): the judge is the
        // only default-path R04/R05 channel, so a bare discard would silently
        // lose genuine same-context violations. The judge historically counted
        // adapters ACROSS contexts against per-context rules, minting phantom
        // R04/R05 for every dialect import whose seeding legitimately shares a
        // port name between contexts (#411) — discard + recompute is the same
        // house pattern as R01.
        const canRecomputeCoverage = Boolean(state.stage3 && state.stage4);
        const leadingRuleTag = /^\[(R\d{2})\]/i;
        const deterministicRule = canRecomputeCoverage
          ? /^R(?:01|04|05|16|17|18)$/i
          : /^R(?:01|16|17|18)$/i;
        const deterministicMention = canRecomputeCoverage
          ? /\bR(?:01|04|05|16|17|18)\b/i
          : /\bR(?:01|16|17|18)\b/i;
        const isDeterministicClaim = (m: string): boolean => {
          const tag = leadingRuleTag.exec(m);
          if (tag) return deterministicRule.test(tag[1] as string);
          return deterministicMention.test(m);
        };
        const finalErrors = errors.filter((m) => !isDeterministicClaim(m));
        const finalWarnings = warnings.filter((m) => !isDeterministicClaim(m));
        for (const ctx of state.stage2?.accepted ?? []) {
          const bannedTokens = bannedTokensInContextName(ctx.name);
          if (bannedTokens.length > 0) {
            const tokenList = bannedTokens.map((t) => `'${t}'`).join(", ");
            // Report the name as it appears in the EMITTED manifest (assembly
            // kebab-cases context names): the finding previously cited
            // 'QueueAdapter' while the YAML said 'queue-adapter' — a context
            // the user cannot find (alvaro-ai).
            finalErrors.push(
              `[R01] Context '${normalizeContextName(ctx.name)}' violates R01: the name contains the banned technology token${
                bannedTokens.length > 1 ? "s" : ""
              } ${tokenList} — rename it to a domain concept (a context is named after a business capability, not a technical pattern).`,
            );
          }
        }

        // Deterministic R04/R05 recompute (companion to the discard above —
        // never gate one without the other). Counts adapters per context via
        // the same helper `structuralManifestErrors` uses, preserving its two
        // carve-outs: shared-kernel contexts are exempt (they must have no
        // ports at all — R09's territory) and adapters with an empty
        // `implements` are not counted as bindings.
        if (state.stage3 && state.stage4) {
          const sharedKernelNorms = new Set<string>();
          for (const ctx of state.stage2?.accepted ?? []) {
            if (ctx.type === "shared-kernel") {
              sharedKernelNorms.add(normalizeContextName(ctx.name));
            }
          }
          // Also honor the assembled manifest's `type:` field — dialect
          // imports map shared-kernel planes onto it during normalization,
          // and stage2 may predate that mapping.
          const rawContexts = state.stage5?.parsedObject?.["bounded_contexts"];
          if (Array.isArray(rawContexts)) {
            for (const raw of rawContexts) {
              if (raw === null || typeof raw !== "object") continue;
              const { name, type } = raw as { name?: unknown; type?: unknown };
              if (
                typeof name === "string" &&
                typeof type === "string" &&
                type.trim().toLowerCase() === "shared-kernel"
              ) {
                sharedKernelNorms.add(normalizeContextName(name));
              }
            }
          }
          // Count + report against the names as they appear in the EMITTED
          // manifest: the assembler normalizes context names (kebab) and port
          // names (PascalCase + Port suffix) when rendering, and Stage-4
          // models answer `implements` with the normalized spellings — so
          // counting raw Stage-3 spellings would manufacture phantom
          // 0-adapter findings and cite ports the user cannot find in the
          // YAML (the alvaro-ai R01 lesson). Normalization happens HERE, not
          // inside the shared helper, so structuralManifestErrors' exact
          // string matching stays byte-identical.
          const normalizedPortMap = {
            contexts: state.stage3.contexts.map((ctx) => ({
              ...ctx,
              contextName:
                typeof ctx.contextName === "string"
                  ? normalizeContextName(ctx.contextName)
                  : ctx.contextName,
              in: ctx.in.map((p) => ({
                ...p,
                name: normalizePortName(p.name),
              })),
              out: ctx.out.map((p) => ({
                ...p,
                name: normalizePortName(p.name),
              })),
            })),
          };
          const normalizedBindings = {
            contexts: state.stage4.contexts.map((ctx) => ({
              ...ctx,
              adapters: ctx.adapters.map((a) => ({
                ...a,
                // Empty implements stays empty (the unbound-adapter skip).
                implements: a.implements
                  ? normalizePortName(a.implements)
                  : a.implements,
              })),
            })),
          };
          finalErrors.push(
            ...portAdapterCoverageErrors(
              normalizedPortMap,
              normalizedBindings,
              sharedKernelNorms,
            ),
          );
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
          // Branch on the whole phrase rather than interpolating the word:
          // the builder deliberately refuses `string` slots, and spelling
          // both literals out is clearer than a ternary inside the template.
          summary: passed
            ? stageSummary`Validation passed: ${finalErrors.length} errors, ${finalWarnings.length} warnings`
            : stageSummary`Validation failed: ${finalErrors.length} errors, ${finalWarnings.length} warnings`,
          ...(modelName !== undefined ? { modelName } : {}),
        });
        return ok(result);
      }

      lastError = parseError;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        return err(
          new StageMaxRetriesError(STAGE_NUMBER, lastError, fullResponse),
        );
      }

      // Build the retry prompt from the ORIGINAL review prompt (not the
      // previous, possibly-already-truncated `prompt`). Stage 6 must re-review
      // the full manifest; the generic buildStageRetryPrompt truncates to 1000
      // chars and strips the manifest, which made a retry trivially "pass"
      // without reviewing anything.
      prompt = buildStage6RetryPrompt(originalPrompt, fullResponse, parseError);
    }

    throw new Error("Unreachable: all retry paths return within loop");
  }
}
