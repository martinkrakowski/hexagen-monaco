import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE2_CLASSIFICATION_SYSTEM_PROMPT,
  compileStage2Prompt,
} from "../../../domain/index.js";
import type {
  PipelineState,
  ClassificationResult,
  ClassifiedContext,
  RejectedContext,
  UncertainContext,
} from "../../../domain/value-objects/pipeline-state.js";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt.js";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors.js";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry.js";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry.js";

const STAGE_NUMBER = 2;

export class ExecuteContextClassificationUseCase {
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

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE2_CLASSIFICATION_SYSTEM_PROMPT },
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
        if (attempt === MAX_RETRY_ATTEMPTS) {
          return err(streamError);
        }
        lastError = `Request error: ${streamError}`;
        continue;
      }

      // Parse NDJSON output
      const lines = fullResponse
        .split("\n")
        .filter((line) => line.trim() !== "");
      const accepted: ClassifiedContext[] = [];
      const rejected: RejectedContext[] = [];
      const uncertain: UncertainContext[] = [];
      let hasValidLine = false;

      const infrastructureBlocklist = [
        "adapter",
        "repository",
        "cache",
        "queue",
        "database",
        "db",
        "api",
        "gateway",
        "postgres",
        "redis",
        "mongo",
        "rabbit",
        "kafka",
        "mqtt",
        "s3",
        "rest",
        "graphql",
      ];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          hasValidLine = true;
          if (parsed.status === "accepted") {
            const isInfra = infrastructureBlocklist.some((term) =>
              parsed.name.toLowerCase().includes(term),
            );
            if (isInfra) {
              rejected.push({
                name: parsed.name,
                reasoning: `Safety Filter: Context name contains infrastructure term. Original LLM reasoning: ${parsed.reasoning}`,
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
          summary: `Classified ${accepted.length} accepted, ${rejected.length} rejected, ${uncertain.length} uncertain contexts`,
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
