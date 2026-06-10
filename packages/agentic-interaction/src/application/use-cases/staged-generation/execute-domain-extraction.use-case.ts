import { ok, err } from "@hexagen/shared";
import {
  STAGE_ATTEMPT_TIMEOUT_MS,
  STAGE1_REFINEMENT_TIMEOUT_MS,
  stageTimeoutError,
} from "./stage-timeout";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE1_DOMAIN_SYSTEM_PROMPT,
  compileStage1Prompt,
} from "../../../domain/index";
import type {
  DomainAnalysis,
  PipelineState,
  AggregateRoot,
  DomainEntity,
  DomainValueObject,
  DomainEvent,
} from "../../../domain/value-objects/pipeline-state";
import {
  buildStageRetryPrompt,
  STAGE1_REFINEMENT_MODE_SUFFIX,
  compileStage1RefinementUserPrompt,
} from "../../../domain/prompts/generate-manifest.prompt";
import { STAGE1_NDJSON_LINE_SCHEMA } from "../../../domain/prompts/ndjson-line-schemas";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry";

const STAGE_NUMBER = 1;

export type Stage1RefinementMode = "always" | "escalation";

/** Draft→refine cascade for Stage 1: a second (stronger) model reviews the
 * drafting model's NDJSON and re-emits the corrected analysis. Validated by
 * the mercury-2→gpt-4o cascade probes (~+3s/run, rescues collapsed drafts —
 * docs/planning/mercury-2-swap-investigation.md §8). */
export interface Stage1RefinementConfig {
  /** Port for the refiner model (e.g. gpt-4o via OpenRouter). Deliberately a
   * separate port from the drafting chain so the two providers can coexist
   * without disturbing fallback-chain ordering. */
  port: SendStructuredRequestPort;
  /** "always": refine every successful draft (the full cascade).
   * "escalation": refine only when the draft still has <2 subdomains after
   * union recovery and the collapse soft-retry (the ~4% tail). */
  mode: Stage1RefinementMode;
}

interface Stage1ParseResult {
  verbs: string[];
  nouns: string[];
  subdomains: string[];
  aggregateRoots: AggregateRoot[];
  entities: DomainEntity[];
  valueObjects: DomainValueObject[];
  domainEvents: DomainEvent[];
  useCases: NonNullable<DomainAnalysis["useCases"]>;
  hasValidLine: boolean;
}

/** Parse Stage-1 NDJSON output (markdown fences stripped, malformed lines
 * ignored). Pure — used for both the draft response and the refined one. */
function parseStage1Response(fullResponse: string): Stage1ParseResult {
  const cleanedResponse = fullResponse
    .split("\n")
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n");

  const lines = cleanedResponse
    .split("\n")
    .filter((line) => line.trim() !== "");
  const result: Stage1ParseResult = {
    verbs: [],
    nouns: [],
    subdomains: [],
    aggregateRoots: [],
    entities: [],
    valueObjects: [],
    domainEvents: [],
    useCases: [],
    hasValidLine: false,
  };

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "verb") {
        result.hasValidLine = true;
        result.verbs.push(parsed.value);
      } else if (parsed.type === "noun") {
        result.hasValidLine = true;
        result.nouns.push(parsed.value);
      } else if (parsed.type === "subdomain") {
        result.hasValidLine = true;
        result.subdomains.push(parsed.value);
      } else if (
        parsed.type === "aggregateRoot" &&
        typeof parsed.name === "string" &&
        typeof parsed.subdomain === "string"
      ) {
        result.hasValidLine = true;
        const ar: AggregateRoot = {
          name: parsed.name,
          subdomain: parsed.subdomain,
        };
        if (Array.isArray(parsed.identityFields)) {
          ar.identityFields = parsed.identityFields;
        }
        result.aggregateRoots.push(ar);
      } else if (
        parsed.type === "entity" &&
        typeof parsed.name === "string" &&
        typeof parsed.parentAggregate === "string"
      ) {
        result.hasValidLine = true;
        result.entities.push({
          name: parsed.name,
          parentAggregate: parsed.parentAggregate,
        });
      } else if (
        parsed.type === "valueObject" &&
        typeof parsed.name === "string"
      ) {
        result.hasValidLine = true;
        result.valueObjects.push({
          name: parsed.name,
          rules: typeof parsed.rules === "string" ? parsed.rules : undefined,
        });
      } else if (
        parsed.type === "domainEvent" &&
        typeof parsed.name === "string" &&
        typeof parsed.emitter === "string"
      ) {
        result.hasValidLine = true;
        result.domainEvents.push({
          name: parsed.name,
          emitter: parsed.emitter,
          trigger:
            typeof parsed.trigger === "string" ? parsed.trigger : undefined,
        });
      } else if (
        parsed.type === "useCase" &&
        typeof parsed.name === "string" &&
        typeof parsed.subdomain === "string"
      ) {
        result.hasValidLine = true;
        result.useCases.push({
          name: parsed.name,
          subdomain: parsed.subdomain,
          actor: typeof parsed.actor === "string" ? parsed.actor : undefined,
          commandName:
            typeof parsed.commandName === "string"
              ? parsed.commandName
              : undefined,
        });
      }
    } catch {
      // Ignore malformed lines
    }
  }

  return result;
}

/** Assemble a DomainAnalysis from parsed lines, applying subdomain union
 * recovery: models sometimes under-emit standalone "subdomain" lines while
 * still assigning every aggregateRoot and useCase a subdomain (mercury-2
 * probes: 1 declared subdomain line vs 4 distinct subdomains across the
 * aggregate/useCase lines — and the declared one can be DISJOINT from the
 * implied set). The full decomposition is in the output either way; union it
 * back in deterministically. Declared lines keep their position; implied
 * subdomains append in encounter order. Exact-string dedupe only — naming
 * normalization is Stage 2's job. */
function buildDomainAnalysis(parsed: Stage1ParseResult): DomainAnalysis {
  const {
    verbs,
    nouns,
    subdomains,
    aggregateRoots,
    entities,
    valueObjects,
    domainEvents,
    useCases,
  } = parsed;

  const seenSubdomains = new Set(subdomains);
  for (const item of [...aggregateRoots, ...useCases]) {
    if (!seenSubdomains.has(item.subdomain)) {
      seenSubdomains.add(item.subdomain);
      subdomains.push(item.subdomain);
    }
  }

  const result: DomainAnalysis = { verbs, nouns, subdomains };
  if (aggregateRoots.length > 0) result.aggregateRoots = aggregateRoots;
  if (entities.length > 0) result.entities = entities;
  if (valueObjects.length > 0) result.valueObjects = valueObjects;
  if (domainEvents.length > 0) result.domainEvents = domainEvents;
  if (useCases.length > 0) result.useCases = useCases;
  return result;
}

export class ExecuteDomainExtractionUseCase {
  // No escalationConfig here: only Stage 3 (ExecutePortMappingUseCase) reads
  // its escalation config; the param was a dead copy-paste in stages 0/1/2/4/6.
  // `refinement` is a different mechanism: a second-model refine pass over a
  // SUCCESSFUL draft, not a retry-with-stronger-model on failure.
  constructor(
    private readonly llmPort: SendStructuredRequestPort,
    private readonly refinement?: Stage1RefinementConfig,
  ) {}

  async execute(
    state: Pick<PipelineState, "stage0">,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    | { success: true; value: DomainAnalysis }
    | { success: false; error: unknown }
  > {
    const stageStart = Date.now();

    // Log stage progress to generation log
    onChunk?.("Analyzing domain architecture...");

    // The pristine prompt is kept for the refine pass; `prompt` itself is
    // rewritten by retry-prompt building below.
    const initialPrompt = compileStage1Prompt(state);
    let prompt = initialPrompt;
    let lastError = "";
    let retryCount = 0;

    // A collapsed-but-valid earlier attempt (single subdomain despite a
    // multi-capability domain — see the soft-retry below). Pre-retry behavior
    // was to return that result immediately, so every error path that still
    // holds it must return it rather than fail the stage: a single-context
    // manifest can be coherent (one passed the Stage-6 judge in harness runs).
    let collapsedFallback: DomainAnalysis | null = null;
    let collapsedFallbackResponse = "";
    let collapsedFallbackTelemetry: StageTelemetry | null = null;
    const failWith = async (
      error: unknown,
    ): Promise<
      | { success: true; value: DomainAnalysis }
      | { success: false; error: unknown }
    > => {
      if (collapsedFallback && collapsedFallbackTelemetry) {
        // A held fallback is by definition <2 subdomains, so both refinement
        // modes fire here — this is exactly the case the cascade rescues.
        const refined = await this.maybeRefineDraft(
          collapsedFallback,
          collapsedFallbackResponse,
          initialPrompt,
          onChunk,
        );
        onStageTelemetry?.({
          ...collapsedFallbackTelemetry,
          durationMs: Date.now() - stageStart,
          retryCount,
          inputTokensEstimate:
            (collapsedFallbackTelemetry.inputTokensEstimate ?? 0) +
            refined.inputTokens,
          outputTokensActual:
            (collapsedFallbackTelemetry.outputTokensActual ?? 0) +
            refined.outputTokens,
          summary: `${collapsedFallbackTelemetry.summary}${refined.note}`,
        });
        return ok(refined.value);
      }
      return err(error);
    };

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
          { role: "system", content: STAGE1_DOMAIN_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        {
          stream: true,
          temperature: 0.1,
          // 1600, not 800: the decomposition requirement in the system prompt
          // makes a correct Stage 1 answer 3-6 subdomains plus their
          // aggregates, use cases, and events — probes showed compliant
          // outputs hitting finish=length at 800 (truncating later
          // subdomains' building blocks).
          maxTokens: 1600,
          ndjsonLineSchema: STAGE1_NDJSON_LINE_SCHEMA,
        },
      );
      request.signal = abortController.signal;

      let responseResult;
      try {
        responseResult = await this.llmPort.sendRequest(request);
      } catch (thrownError) {
        if (isTimedOut) {
          return failWith(
            stageTimeoutError("Domain extraction", STAGE_ATTEMPT_TIMEOUT_MS),
          );
        }
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return failWith(
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
        if (isTimedOut) {
          return failWith(
            stageTimeoutError("Domain extraction", STAGE_ATTEMPT_TIMEOUT_MS),
          );
        }
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return failWith(streamError);
        }
        lastError = `Request error: ${streamError}`;
        continue;
      }

      const parsed = parseStage1Response(fullResponse);
      const parseError = !parsed.hasValidLine
        ? "No valid NDJSON lines found in output"
        : "";

      if (!parseError) {
        const result = buildDomainAnalysis(parsed);
        const { verbs, nouns, subdomains, aggregateRoots, useCases } = parsed;

        // Collapse soft-retry: ~4% of runs declare a single subdomain even
        // after union recovery, while the same output carries 3+ aggregates
        // or 4+ use cases — the model's own output proves the domain is
        // multi-capability, so "more than one context expected" needs no
        // external signal. Re-prompt with a decomposition nudge; keep the
        // collapsed result as a fallback so exhausted retries (or later
        // failures) accept it instead of failing the run. Genuinely small
        // domains (1-2 aggregates) never trigger this.
        const provenMultiCapability =
          aggregateRoots.length >= 3 || useCases.length >= 4;
        if (
          subdomains.length < 2 &&
          provenMultiCapability &&
          attempt < MAX_RETRY_ATTEMPTS
        ) {
          collapsedFallback = result;
          collapsedFallbackResponse = fullResponse;
          collapsedFallbackTelemetry = {
            stage: STAGE_NUMBER,
            label: "Domain Extraction",
            durationMs: 0, // overwritten at accept time
            usedLLM: true,
            retryCount,
            inputTokensEstimate: estimateTokenCount(prompt),
            outputTokensActual: estimateTokenCount(fullResponse),
            servedFromCache: false,
            summary: `Extracted ${verbs.length} verbs, ${nouns.length} nouns, ${subdomains.length} subdomains, ${aggregateRoots.length} aggregates (accepted single-subdomain output after decomposition retry)`,
          };
          lastError = `Output declared ${subdomains.length} subdomain(s) for a domain with ${aggregateRoots.length} aggregateRoot(s) and ${useCases.length} useCase(s)`;
          prompt = buildStageRetryPrompt({
            stage: STAGE_NUMBER,
            attempt: attempt + 1,
            failedOutput: fullResponse,
            errorDetail: `${lastError}. This domain has multiple distinct business capabilities — re-emit the FULL output with one "subdomain" line per capability (3-6 typical, see DECOMPOSITION REQUIREMENT) and assign every aggregateRoot and useCase to its capability's subdomain.`,
            originalPrompt: prompt,
          }).content;
          continue;
        }

        const refined = await this.maybeRefineDraft(
          result,
          fullResponse,
          initialPrompt,
          onChunk,
        );
        const durationMs = Date.now() - stageStart;
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Domain Extraction",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt) + refined.inputTokens,
          outputTokensActual:
            estimateTokenCount(fullResponse) + refined.outputTokens,
          servedFromCache: false,
          summary: `Extracted ${verbs.length} verbs, ${nouns.length} nouns, ${subdomains.length} subdomains, ${aggregateRoots.length} aggregates${refined.note}`,
        });
        return ok(refined.value);
      }

      lastError = parseError;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        return failWith(
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

    return failWith(new StageMaxRetriesError(STAGE_NUMBER, lastError, ""));
  }

  /** One refine attempt against the refiner port (the draft→refine cascade).
   * Soft by design: refiner error, timeout, unparseable output, or an output
   * that would LOSE subdomains all keep the draft — refinement can only ever
   * improve a successful stage, never fail it. Single attempt, no retries:
   * the draft is already a valid answer. */
  private async maybeRefineDraft(
    draft: DomainAnalysis,
    draftResponse: string,
    initialPrompt: string,
    onChunk?: (chunk: string) => void,
  ): Promise<{
    value: DomainAnalysis;
    note: string;
    inputTokens: number;
    outputTokens: number;
  }> {
    // Refinement skipped — no request sent, nothing to bill.
    const skipped = { value: draft, note: "", inputTokens: 0, outputTokens: 0 };
    if (!this.refinement) return skipped;
    if (this.refinement.mode === "escalation" && draft.subdomains.length >= 2) {
      return skipped;
    }

    onChunk?.("Refining domain analysis...");
    // From here the refine request IS dispatched, so its prompt tokens are
    // billed even when the draft is kept (error / discard paths) — report
    // them unconditionally so telemetry tracks actual spend. User prompt
    // only, matching the draft path's estimateTokenCount(prompt).
    const refinementPrompt = compileStage1RefinementUserPrompt(
      initialPrompt,
      draftResponse,
    );
    const inputTokens = estimateTokenCount(refinementPrompt);
    const keepDraft = { value: draft, note: "", inputTokens, outputTokens: 0 };
    const abortController = new AbortController();
    // Tight best-effort ceiling, NOT the stage timeout: an aborted refine
    // keeps the draft, so the only cost of firing early is a lost upgrade.
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      STAGE1_REFINEMENT_TIMEOUT_MS,
    );
    try {
      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          {
            role: "system",
            content: `${STAGE1_DOMAIN_SYSTEM_PROMPT}${STAGE1_REFINEMENT_MODE_SUFFIX}`,
          },
          {
            role: "user",
            content: refinementPrompt,
          },
        ],
        z.string(),
        // 2400 and temperature 0.3: exactly the cascade-probe config that
        // produced 8/8 valid NDJSON. The refiner re-emits the draft PLUS
        // corrections, so it needs headroom over the drafting cap (1600).
        { stream: true, temperature: 0.3, maxTokens: 2400 },
      );
      request.signal = abortController.signal;

      const responseResult = await this.refinement.port.sendRequest(request);
      if (!responseResult.success) return keepDraft;

      // The response arrived, so its tokens are billed whether or not the
      // refinement is accepted below.
      const outputTokens = estimateTokenCount(responseResult.value.content);
      const discardRefinement = { ...keepDraft, outputTokens };

      const refinedParsed = parseStage1Response(responseResult.value.content);
      if (!refinedParsed.hasValidLine) return discardRefinement;
      const refinedResult = buildDomainAnalysis(refinedParsed);
      // Never lose decomposition: the refined output must preserve or improve
      // the post-union subdomain count, else the draft stands.
      if (refinedResult.subdomains.length < draft.subdomains.length) {
        return discardRefinement;
      }

      return {
        value: refinedResult,
        note: ` (cascade refined ${draft.subdomains.length}→${refinedResult.subdomains.length} subdomains)`,
        inputTokens,
        outputTokens,
      };
    } catch {
      return keepDraft;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
