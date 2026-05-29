import type { ZodSchema } from "zod";
import type { Result } from "../../../shared/result";
import type { LLMError } from "../../../infrastructure/llm/errors/llm-errors";

export interface LLMCallOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  systemPrompt?: string;
}

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LLMResponse = {
  content: string;
  model: string;
  usage: TokenUsage;
};

export interface LLMClientPort {
  call(
    prompt: string,
    options?: LLMCallOptions,
  ): Promise<Result<LLMResponse, LLMError>>;

  callStructured<T>(
    prompt: string,
    schema: ZodSchema<T>,
    options?: LLMCallOptions,
  ): Promise<Result<T, LLMError>>;
}
