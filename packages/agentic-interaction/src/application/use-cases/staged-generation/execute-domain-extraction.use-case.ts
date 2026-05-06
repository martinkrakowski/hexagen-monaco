import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm";
import { z } from "zod";
import {
  STAGE1_DOMAIN_SYSTEM_PROMPT,
  compileStage1Prompt,
} from "../../../domain/index.js";
import type {
  DomainAnalysis,
  PipelineState,
} from "../../../domain/value-objects/pipeline-state.js";

export class ExecuteDomainExtractionUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<PipelineState, "stage0">,
    onChunk?: (chunk: string) => void,
  ): Promise<{ success: true; value: DomainAnalysis } | { success: false; error: unknown }> {
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

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "verb") {
          verbs.push(parsed.value);
        } else if (parsed.type === "noun") {
          nouns.push(parsed.value);
        } else if (parsed.type === "subdomain") {
          subdomains.push(parsed.value);
        }
      } catch {
        // ignore malformed NDJSON lines
      }
    }

    return ok({ verbs, nouns, subdomains });
  }
}
