import { ok, err } from "@hexagen/shared";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  STAGE4_ADAPTERS_SYSTEM_PROMPT,
  compileStage4Prompt,
} from "../../../domain/index.js";
import type {
  AdapterBindings,
  PipelineState,
  ContextAdapters,
} from "../../../domain/value-objects/pipeline-state.js";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt.js";

export class ExecuteAdapterAssignmentUseCase {
  constructor(private readonly llmPort: SendStructuredRequestPort) {}

  async execute(
    state: Pick<PipelineState, "stage0" | "stage3">,
    variables: PromptVariables,
    onChunk?: (chunk: string) => void,
  ): Promise<
    | { success: true; value: AdapterBindings }
    | { success: false; error: unknown }
  > {
    const prompt = compileStage4Prompt(state, variables);

    const request = createLLMRequest(
      DomainModelId.QWEN_CODER_3B,
      [
        { role: "system", content: STAGE4_ADAPTERS_SYSTEM_PROMPT },
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
    const contextAdaptersMap = new Map<
      string,
      Array<{ name: string; type: string; implements: string }>
    >();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const {
          contextName,
          adapterName,
          adapterType,
          implements: impl,
        } = parsed;

        if (!contextName || !adapterName || !adapterType || !impl) continue;

        if (!contextAdaptersMap.has(contextName)) {
          contextAdaptersMap.set(contextName, []);
        }

        contextAdaptersMap.get(contextName)!.push({
          name: adapterName,
          type: adapterType,
          implements: impl,
        });
      } catch {
        // ignore malformed NDJSON lines
      }
    }

    const contexts: ContextAdapters[] = [];
    for (const [contextName, adapters] of contextAdaptersMap.entries()) {
      contexts.push({ contextName, adapters });
    }

    return ok({ contexts });
  }
}
