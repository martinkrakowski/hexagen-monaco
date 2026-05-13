import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE0_NORMALIZATION_SYSTEM_PROMPT,
  compileStage0Prompt,
} from "../../../domain/index.js";
import type { NormalizedPrompt } from "../../../domain/value-objects/pipeline-state.js";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt.js";

export class ExecutePromptNormalizationUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    userDescription: string,
    variables?: PromptVariables,
    onChunk?: (chunk: string) => void,
  ): Promise<
    | { success: true; value: NormalizedPrompt }
    | { success: false; error: unknown }
  > {
    const prompt = compileStage0Prompt({}, variables || { userDescription });

    const request = createLLMRequest(
      DomainModelId.QWEN_CODER_3B,
      [
        { role: "system", content: STAGE0_NORMALIZATION_SYSTEM_PROMPT },
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
    let intent = "";
    const explicitTechnologies: string[] = [];
    const explicitPatterns: string[] = [];
    const ambiguities: string[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "intent") {
          intent = parsed.value;
        } else if (parsed.type === "technology") {
          explicitTechnologies.push(parsed.value);
        } else if (parsed.type === "pattern") {
          explicitPatterns.push(parsed.value);
        } else if (parsed.type === "ambiguity") {
          ambiguities.push(parsed.value);
        }
      } catch {
        // ignore malformed NDJSON lines
      }
    }

    return ok({
      intent,
      explicitTechnologies,
      explicitPatterns,
      ambiguities,
    });
  }
}
