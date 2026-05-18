import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE1_DOMAIN_SYSTEM_PROMPT,
  compileStage1Prompt,
} from "../../../domain/index.js";
import type {
  DomainAnalysis,
  PipelineState,
  AggregateRoot,
  DomainEntity,
  DomainValueObject,
  DomainEvent,
} from "../../../domain/value-objects/pipeline-state.js";
import { buildStageRetryPrompt } from "../../../domain/prompts/generate-manifest.prompt.js";
import { MAX_RETRY_ATTEMPTS } from "../../../domain/errors/stage-errors.js";
import { StageMaxRetriesError } from "../../../domain/errors/stage-errors.js";
import type { StageTelemetry } from "../../../domain/value-objects/stage-telemetry.js";
import { estimateTokenCount } from "../../../domain/value-objects/stage-telemetry.js";

const STAGE_NUMBER = 1;

export class ExecuteDomainExtractionUseCase {
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
    let prompt = compileStage1Prompt(state);
    let lastError = "";
    let retryCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      retryCount = attempt - 1;
      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: STAGE1_DOMAIN_SYSTEM_PROMPT },
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
            aggregateRoots.push({
              name: parsed.name,
              subdomain: parsed.subdomain,
              identityFields: Array.isArray(parsed.identityFields)
                ? parsed.identityFields
                : undefined,
            });
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
        const durationMs = Date.now() - stageStart;
        const result: DomainAnalysis = { verbs, nouns, subdomains };
        if (aggregateRoots.length > 0) result.aggregateRoots = aggregateRoots;
        if (entities.length > 0) result.entities = entities;
        if (valueObjects.length > 0) result.valueObjects = valueObjects;
        if (domainEvents.length > 0) result.domainEvents = domainEvents;
        if (useCases.length > 0) result.useCases = useCases;
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
