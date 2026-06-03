import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import {
  boundedContextTypeSchema,
  type BoundedContextType,
} from "@hexagen/shared";
import {
  CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT,
  compileClassifyContextTypePrompt,
} from "../../../domain/prompts/classify-context-type.prompt";

const ClassifyResponseSchema = z.object({
  type: boundedContextTypeSchema,
  reasoning: z.string(),
});

export type ClassifyContextTypePort = SendStructuredRequestPort;

export class ClassifyContextTypeUseCase {
  constructor(private readonly llmPort: ClassifyContextTypePort) {}

  async execute(
    context: {
      name: string;
      responsibility?: string;
      aggregates?: string[];
      value_objects?: string[];
    },
    projectContext?: string,
    signal?: AbortSignal,
  ): Promise<
    | {
        success: true;
        type: BoundedContextType;
        reasoning: string;
      }
    | { success: false; error: unknown }
  > {
    try {
      const userPrompt = compileClassifyContextTypePrompt(
        context,
        projectContext,
      );
      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        ClassifyResponseSchema,
        { stream: false, temperature: 0.1, maxTokens: 256 },
      );
      if (signal) {
        request.signal = signal;
      }
      const result = await this.llmPort.sendRequest(request);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      const rawContent = result.value.content;
      let content = rawContent;
      const fenceMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        content = fenceMatch[1].trim();
      }
      const parsed = ClassifyResponseSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        return { success: false, error: parsed.error };
      }
      return {
        success: true,
        type: parsed.data.type,
        reasoning: parsed.data.reasoning,
      };
    } catch (error) {
      return { success: false, error };
    }
  }
}
