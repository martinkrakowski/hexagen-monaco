import type { ZodSchema } from "zod";

export interface LocalLlmMessagingPort {
  sendStructuredPrompt(
    userPrompt: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): Promise<string>;
}

export interface LocalLlmStructuredMessagingPort {
  sendStructuredPrompt<T>(
    userPrompt: string,
    systemPrompt: string,
    schema: ZodSchema<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}

export type LocalLlmPort = LocalLlmMessagingPort | LocalLlmStructuredMessagingPort;
