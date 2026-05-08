/* eslint-disable no-console */
import type { SendStructuredRequestPort } from "@hexagen/local-llm/shared";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/shared";
import { z } from "zod";
import { parseJSON } from "../../domain/index.js";
import type { RetryResult } from "../../domain/prompts/generate-manifest.prompt.js";

interface RetryCallResult<T> {
  data: T;
  tokens: number;
  model: string;
  repairApplied: boolean;
  attempts: number;
}

async function callWithRetries<T>(
  llmPipeline: SendStructuredRequestPort,
  phase: string,
  systemPrompt: string,
  initialUserPrompt: string,
  retryFactory: (attempt: number) => RetryResult,
  maxTokens: number,
): Promise<RetryCallResult<T>> {
  let tokens = 0;
  let model = "unknown";
  let repairApplied = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    let userPrompt: string;
    if (attempt === 0) {
      userPrompt = initialUserPrompt;
    } else {
      const retryResult = retryFactory(attempt);
      userPrompt = retryResult.content;
    }

    console.log(
      `[manifest-gen] phase=${phase}, attempt=${attempt}, maxTokens=${maxTokens}`,
    );

    const llmRequest = createLLMRequest(
      DomainModelId.QWEN_CODER_3B,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      z.string(),
      {
        temperature: 0.1,
        maxTokens,
      },
    );

    const result = await llmPipeline.sendRequest(llmRequest);
    if (!result.success) {
      console.log(
        `[manifest-gen] phase=${phase}, attempt=${attempt}, llmFailed=true`,
      );
      continue;
    }

    tokens += result.value.usage?.totalTokens || 0;
    model = result.value.modelId || model;

    if (!result.value.content) {
      console.log(
        `[manifest-gen] phase=${phase}, attempt=${attempt}, emptyResponse=true`,
      );
      continue;
    }

    const parsed = parseJSON<T>(result.value.content);
    if (parsed.ok) {
      if (parsed.repairApplied) repairApplied = true;
      console.log(
        `[manifest-gen] phase=${phase}, attempt=${attempt}, success=true, repairApplied=${parsed.repairApplied}`,
      );
      return {
        data: parsed.data,
        tokens,
        model,
        repairApplied,
        attempts: attempt + 1,
      };
    }

    console.log(
      `[manifest-gen] phase=${phase}, attempt=${attempt}, parseFailed=true, repairAttempted=${parsed.repairApplied}`,
    );
  }

  throw new Error(`${phase}: failed to generate valid JSON after 3 attempts`);
}

export { callWithRetries };
export type { RetryCallResult };
