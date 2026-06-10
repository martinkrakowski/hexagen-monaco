import { ok, err } from "@hexagen/shared";
import { STAGE_ATTEMPT_TIMEOUT_MS, stageTimeoutError } from "./stage-timeout";
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
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry";

const STAGE_NUMBER = 1;

export class ExecuteDomainExtractionUseCase {
  // No escalationConfig here: only Stage 3 (ExecutePortMappingUseCase) reads
  // its escalation config; the param was a dead copy-paste in stages 0/1/2/4/6.
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

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

    let prompt = compileStage1Prompt(state);
    let lastError = "";
    let retryCount = 0;

    // A collapsed-but-valid earlier attempt (single subdomain despite a
    // multi-capability domain — see the soft-retry below). Pre-retry behavior
    // was to return that result immediately, so every error path that still
    // holds it must return it rather than fail the stage: a single-context
    // manifest can be coherent (one passed the Stage-6 judge in harness runs).
    let collapsedFallback: DomainAnalysis | null = null;
    let collapsedFallbackTelemetry: StageTelemetry | null = null;
    const failWith = (
      error: unknown,
    ):
      | { success: true; value: DomainAnalysis }
      | { success: false; error: unknown } => {
      if (collapsedFallback && collapsedFallbackTelemetry) {
        onStageTelemetry?.({
          ...collapsedFallbackTelemetry,
          durationMs: Date.now() - stageStart,
          retryCount,
        });
        return ok(collapsedFallback);
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
        // 1600, not 800: the decomposition requirement in the system prompt
        // makes a correct Stage 1 answer 3-6 subdomains plus their aggregates,
        // use cases, and events — probes showed compliant outputs hitting
        // finish=length at 800 (truncating later subdomains' building blocks).
        { stream: true, temperature: 0.1, maxTokens: 1600 },
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

      // Parse NDJSON output — strip markdown code fences first
      const cleanedResponse = fullResponse
        .split("\n")
        .filter((line) => !line.trim().startsWith("```"))
        .join("\n");

      const lines = cleanedResponse
        .split("\n")
        .filter((line) => line.trim() !== "");
      const verbs: string[] = [];
      const nouns: string[] = [];
      const subdomains: string[] = [];
      const aggregateRoots: AggregateRoot[] = [];
      const entities: DomainEntity[] = [];
      const valueObjects: DomainValueObject[] = [];
      const domainEvents: DomainEvent[] = [];
      const useCases: DomainAnalysis["useCases"] = [];
      let hasValidLine = false;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "verb") {
            hasValidLine = true;
            verbs.push(parsed.value);
          } else if (parsed.type === "noun") {
            hasValidLine = true;
            nouns.push(parsed.value);
          } else if (parsed.type === "subdomain") {
            hasValidLine = true;
            subdomains.push(parsed.value);
          } else if (
            parsed.type === "aggregateRoot" &&
            typeof parsed.name === "string" &&
            typeof parsed.subdomain === "string"
          ) {
            hasValidLine = true;
            const ar: AggregateRoot = {
              name: parsed.name,
              subdomain: parsed.subdomain,
            };
            if (Array.isArray(parsed.identityFields)) {
              ar.identityFields = parsed.identityFields;
            }
            aggregateRoots.push(ar);
          } else if (
            parsed.type === "entity" &&
            typeof parsed.name === "string" &&
            typeof parsed.parentAggregate === "string"
          ) {
            hasValidLine = true;
            entities.push({
              name: parsed.name,
              parentAggregate: parsed.parentAggregate,
            });
          } else if (
            parsed.type === "valueObject" &&
            typeof parsed.name === "string"
          ) {
            hasValidLine = true;
            valueObjects.push({
              name: parsed.name,
              rules:
                typeof parsed.rules === "string" ? parsed.rules : undefined,
            });
          } else if (
            parsed.type === "domainEvent" &&
            typeof parsed.name === "string" &&
            typeof parsed.emitter === "string"
          ) {
            hasValidLine = true;
            domainEvents.push({
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
            hasValidLine = true;
            useCases.push({
              name: parsed.name,
              subdomain: parsed.subdomain,
              actor:
                typeof parsed.actor === "string" ? parsed.actor : undefined,
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

      const parseError = !hasValidLine
        ? "No valid NDJSON lines found in output"
        : "";

      if (!parseError) {
        // Subdomain recovery: models sometimes under-emit standalone
        // "subdomain" lines while still assigning every aggregateRoot and
        // useCase a subdomain (mercury-2 probes: 1 declared subdomain line vs
        // 4 distinct subdomains across the aggregate/useCase lines — and the
        // declared one can be DISJOINT from the implied set). The full
        // decomposition is in the output either way; union it back in
        // deterministically. Declared lines keep their position; implied
        // subdomains append in encounter order. Exact-string dedupe only —
        // naming normalization is Stage 2's job.
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

        const durationMs = Date.now() - stageStart;
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Domain Extraction",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt),
          outputTokensActual: estimateTokenCount(fullResponse),
          servedFromCache: false,
          summary: `Extracted ${verbs.length} verbs, ${nouns.length} nouns, ${subdomains.length} subdomains, ${aggregateRoots.length} aggregates`,
        });
        return ok(result);
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
}
