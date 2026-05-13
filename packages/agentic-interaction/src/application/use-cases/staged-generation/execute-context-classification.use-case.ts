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

export class ExecuteContextClassificationUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<PipelineState, "stage0" | "stage1">,
    onChunk?: (chunk: string) => void,
  ): Promise<
    | { success: true; value: ClassificationResult }
    | { success: false; error: unknown }
  > {
    const prompt = compileStage2Prompt(state);

    const request = createLLMRequest(
      DomainModelId.QWEN_CODER_3B,
      [
        { role: "system", content: STAGE2_CLASSIFICATION_SYSTEM_PROMPT },
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
    const accepted: ClassifiedContext[] = [];
    const rejected: RejectedContext[] = [];
    const uncertain: UncertainContext[] = [];

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
          accepted.push({
            name: parsed.name,
            type: ctxType,
            reasoning: parsed.reasoning,
          });
        } else if (parsed.status === "rejected") {
          rejected.push({
            name: parsed.name,
            reasoning: parsed.reasoning,
          });
        } else if (parsed.status === "uncertain") {
          uncertain.push({
            name: parsed.name,
            reasoning: parsed.reasoning,
          });
        }
      } catch {
        // ignore malformed NDJSON lines
      }
    }

    return ok({ accepted, rejected, uncertain });
  }
}
