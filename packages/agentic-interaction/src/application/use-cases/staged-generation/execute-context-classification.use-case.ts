import { ok, err } from "@hexagen/shared";
import { STAGE_ATTEMPT_TIMEOUT_MS, stageTimeoutError } from "./stage-timeout";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE2_CLASSIFICATION_SYSTEM_PROMPT,
  compileStage2Prompt,
} from "../../../domain/index";
import { isBannedContextName } from "../../../domain/prompts/architecture-contract";
import { STAGE2_NDJSON_LINE_SCHEMA } from "../../../domain/prompts/ndjson-line-schemas";
import type {
  PipelineState,
  ClassificationResult,
  ClassifiedContext,
  RejectedContext,
  UncertainContext,
} from "../../../domain/value-objects/pipeline-state";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry";
import {
  estimateTokenCount,
  modelNameFromResponseMetadata,
  stageSummary,
} from "../../../domain/value-objects/stage-telemetry";

const STAGE_NUMBER = 2;

export class ExecuteContextClassificationUseCase {
  // No escalationConfig here: only Stage 3 (ExecutePortMappingUseCase) reads
  // its escalation config; the param was a dead copy-paste in stages 0/1/2/4/6.
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<PipelineState, "stage0" | "stage1">,
    onChunk?: (chunk: string) => void,
    onStageTelemetry?: (telemetry: StageTelemetry) => void,
  ): Promise<
    | { success: true; value: ClassificationResult }
    | { success: false; error: unknown }
  > {
    const stageStart = Date.now();
    let prompt = compileStage2Prompt(state);
    let lastError = "";
    let retryCount = 0;
    let modelName: string | undefined;

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
          { role: "system", content: STAGE2_CLASSIFICATION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        z.string(),
        {
          stream: true,
          temperature: 0.1,
          maxTokens: 800,
          ndjsonLineSchema: STAGE2_NDJSON_LINE_SCHEMA,
        },
      );
      request.signal = abortController.signal;

      let responseResult;
      try {
        responseResult = await this.llmPort.sendRequest(request);
      } catch (thrownError) {
        if (isTimedOut) {
          return err(
            stageTimeoutError(
              "Context classification",
              STAGE_ATTEMPT_TIMEOUT_MS,
            ),
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
      let fullResponse = "";
      let streamError: unknown = null;

      if (!responseResult.success) {
        streamError = responseResult.error;
      } else {
        fullResponse = responseResult.value.content;
        // Last-write-wins across retry attempts: the cloud adapter sets
        // metadata.model on every successful response, so the winning
        // attempt always overwrites; `?? modelName` only guards against a
        // port omitting metadata, where "last known served model" is the
        // best-effort answer. Telemetry is emitted in the same iteration
        // as the winning parse below.
        modelName =
          modelNameFromResponseMetadata(responseResult.value.metadata) ??
          modelName;
        if (onChunk && fullResponse) {
          onChunk(fullResponse);
        }
      }

      if (streamError) {
        if (isTimedOut) {
          return err(
            stageTimeoutError(
              "Context classification",
              STAGE_ATTEMPT_TIMEOUT_MS,
            ),
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
      const accepted: ClassifiedContext[] = [];
      const rejected: RejectedContext[] = [];
      const uncertain: UncertainContext[] = [];
      let hasValidLine = false;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          hasValidLine = true;
          if (parsed.status === "accepted") {
            // Token-boundary match (not substring): "user-database" is
            // rejected, "restaurant-booking" is not. See architecture-contract.
            if (isBannedContextName(parsed.name)) {
              rejected.push({
                name: parsed.name,
                reasoning: `Safety Filter: Context name contains a banned token (structural/delivery/infrastructure/vendor). Original LLM reasoning: ${parsed.reasoning}`,
              });
              continue;
            }
            let ctxType: ClassifiedContext["type"] = "core";
            if (
              parsed.contextType === "supporting" ||
              parsed.contextType === "generic" ||
              parsed.contextType === "shared-kernel"
            ) {
              ctxType = parsed.contextType;
            }
            const acceptedCtx: ClassifiedContext = {
              name: parsed.name,
              type: ctxType,
              reasoning: parsed.reasoning,
            };
            if (typeof parsed.responsibility === "string") {
              acceptedCtx.responsibility = parsed.responsibility;
            }
            if (
              Array.isArray(parsed.aggregateRoots) &&
              parsed.aggregateRoots.every((v: unknown) => typeof v === "string")
            ) {
              acceptedCtx.aggregateRoots = parsed.aggregateRoots;
            }
            if (
              Array.isArray(parsed.useCaseNames) &&
              parsed.useCaseNames.every((v: unknown) => typeof v === "string")
            ) {
              acceptedCtx.useCaseNames = parsed.useCaseNames;
            }
            if (
              Array.isArray(parsed.eventsPublished) &&
              parsed.eventsPublished.every(
                (v: unknown) => typeof v === "string",
              )
            ) {
              acceptedCtx.eventsPublished = parsed.eventsPublished;
            }
            accepted.push(acceptedCtx);
          } else if (parsed.status === "rejected") {
            rejected.push({
              name: parsed.name,
              reasoning: parsed.reasoning,
            });
          } else if (parsed.status === "uncertain") {
            const rec = parsed.recommendation ?? "accept-as-supporting";
            if (rec === "reject") {
              rejected.push({ name: parsed.name, reasoning: parsed.reasoning });
            } else if (isBannedContextName(parsed.name)) {
              // The uncertain→accepted promotion path must pass the same
              // safety filter as directly-accepted contexts; previously it
              // bypassed the filter entirely.
              rejected.push({
                name: parsed.name,
                reasoning: `Safety Filter: Context name contains a banned token (structural/delivery/infrastructure/vendor). Original LLM reasoning: ${parsed.reasoning}`,
              });
            } else {
              const typeMap: Record<string, ClassifiedContext["type"]> = {
                "accept-as-core": "core",
                "accept-as-supporting": "supporting",
                "accept-as-generic": "generic",
                "accept-as-shared-kernel": "shared-kernel",
              };
              accepted.push({
                name: parsed.name,
                type: typeMap[rec] ?? "supporting",
                reasoning: parsed.reasoning,
                responsibility: parsed.reasoning,
                aggregateRoots: [],
                useCaseNames: [],
                eventsPublished: [],
                promotedFromUncertain: true,
              });
            }
            // Buckets are deliberately NOT disjoint: `uncertain` records model
            // hesitation regardless of the final verdict (a banned promoted
            // name appears in both `rejected` and `uncertain`). Verified safe:
            // `rejected` has no src consumers; `uncertain` only feeds the
            // <promoted_from_uncertain> prose block in the stage-6 prompt.
            uncertain.push({ name: parsed.name, reasoning: parsed.reasoning });
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
        const result: ClassificationResult = { accepted, rejected, uncertain };
        onStageTelemetry?.({
          stage: STAGE_NUMBER,
          label: "Context Classification",
          durationMs,
          usedLLM: true,
          retryCount,
          inputTokensEstimate: estimateTokenCount(prompt),
          outputTokensActual: estimateTokenCount(fullResponse),
          servedFromCache: false,
          summary: stageSummary`Classified ${accepted.length} accepted, ${rejected.length} rejected, ${uncertain.length} uncertain contexts`,
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
