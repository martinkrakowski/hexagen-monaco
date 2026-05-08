import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/shared";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/shared";
import { z } from "zod";
import {
  STAGE6_VALIDATION_SYSTEM_PROMPT,
  compileStage6Prompt,
} from "../../../domain/index.js";
import type {
  ValidationReport,
  PipelineState,
} from "../../../domain/value-objects/pipeline-state.js";

export class ExecuteValidationReviewUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<PipelineState, "stage5">,
    onChunk?: (chunk: string) => void,
  ): Promise<
    | { success: true; value: ValidationReport }
    | { success: false; error: unknown }
  > {
    const prompt = compileStage6Prompt(state);

    const request = createLLMRequest(
      DomainModelId.QWEN_CODER_3B,
      [
        { role: "system", content: STAGE6_VALIDATION_SYSTEM_PROMPT },
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
    const errors: string[] = [];
    const warnings: string[] = [];
    let passed = true;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "error") {
          errors.push(parsed.message);
          passed = false;
        } else if (parsed.type === "warning") {
          warnings.push(parsed.message);
        } else if (parsed.type === "result") {
          passed = !!parsed.passed;
        }
      } catch {
        // ignore malformed NDJSON lines
      }
    }

    return ok({ errors, warnings, passed });
  }
}
