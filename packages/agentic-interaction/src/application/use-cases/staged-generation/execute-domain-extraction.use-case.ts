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

export class ExecuteDomainExtractionUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<PipelineState, "stage0">,
    onChunk?: (chunk: string) => void,
  ): Promise<
    | { success: true; value: DomainAnalysis }
    | { success: false; error: unknown }
  > {
    const prompt = compileStage1Prompt(state);

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
    for await (const chunkResult of stream) {
      if (!chunkResult.success) {
        return err(chunkResult.error);
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

    const lines = fullResponse.split("\n").filter((line) => line.trim() !== "");
    const verbs: string[] = [];
    const nouns: string[] = [];
    const subdomains: string[] = [];
    const aggregateRoots: AggregateRoot[] = [];
    const entities: DomainEntity[] = [];
    const valueObjects: DomainValueObject[] = [];
    const domainEvents: DomainEvent[] = [];
    const useCases: DomainAnalysis["useCases"] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "verb") {
          verbs.push(parsed.value);
        } else if (parsed.type === "noun") {
          nouns.push(parsed.value);
        } else if (parsed.type === "subdomain") {
          subdomains.push(parsed.value);
        } else if (
          parsed.type === "aggregateRoot" &&
          typeof parsed.name === "string" &&
          typeof parsed.subdomain === "string"
        ) {
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
          entities.push({
            name: parsed.name,
            parentAggregate: parsed.parentAggregate,
          });
        } else if (
          parsed.type === "valueObject" &&
          typeof parsed.name === "string"
        ) {
          valueObjects.push({
            name: parsed.name,
            rules: typeof parsed.rules === "string" ? parsed.rules : undefined,
          });
        } else if (
          parsed.type === "domainEvent" &&
          typeof parsed.name === "string" &&
          typeof parsed.emitter === "string"
        ) {
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
          useCases.push({
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
        // ignore malformed NDJSON lines
      }
    }

    const result: DomainAnalysis = { verbs, nouns, subdomains };
    if (aggregateRoots.length > 0) result.aggregateRoots = aggregateRoots;
    if (entities.length > 0) result.entities = entities;
    if (valueObjects.length > 0) result.valueObjects = valueObjects;
    if (domainEvents.length > 0) result.domainEvents = domainEvents;
    if (useCases.length > 0) result.useCases = useCases;

    return ok(result);
  }
}
