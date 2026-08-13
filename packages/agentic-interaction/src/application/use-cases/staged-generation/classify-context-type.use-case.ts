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
import { STAGE_ATTEMPT_TIMEOUT_MS, stageTimeoutError } from "./stage-timeout";

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
    // Compose external + internal abort. The internal controller fires on the
    // short-output ceiling (this stage emits ≤256 tokens); the optional
    // external signal lets callers cancel mid-flight. `isTimedOut`
    // distinguishes a deadline abort (surface stageTimeoutError) from a
    // caller cancel (surface the abort error unchanged).
    let isTimedOut = false;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      abortController.abort();
    }, STAGE_ATTEMPT_TIMEOUT_MS);
    const onExternalAbort = () => abortController.abort();
    if (signal) {
      if (signal.aborted) {
        abortController.abort();
      } else {
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

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
      request.signal = abortController.signal;
      const result = await this.llmPort.sendRequest(request);
      if (!result.success) {
        // Adapters report a deadline abort as a returned failure (not a
        // throw), so catch the timeout here too.
        if (isTimedOut) {
          // Deliberately no retry on timeout: the caller fail-softs to its
          // heuristic classification (stage-2 low-confidence loop).
          return {
            success: false,
            error: stageTimeoutError(
              "Context-type classification",
              STAGE_ATTEMPT_TIMEOUT_MS,
            ),
          };
        }
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
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (isAbort && isTimedOut) {
        // Deliberately no retry on timeout: the caller fail-softs to its
        // heuristic classification (stage-2 low-confidence loop).
        return {
          success: false,
          error: stageTimeoutError(
            "Context-type classification",
            STAGE_ATTEMPT_TIMEOUT_MS,
          ),
        };
      }
      // External cancel (abort without a fired deadline) and every other
      // failure surface unchanged.
      return { success: false, error };
    } finally {
      clearTimeout(timeoutHandle);
      if (signal) {
        signal.removeEventListener("abort", onExternalAbort);
      }
    }
  }
}
