import type { Identifier } from "@hexagen/shared";
import type { DomainModelId } from "./model-id.vo.js";
import type { ZodSchema } from "zod";

export interface LLMRequest {
  id: Identifier;
  modelId: DomainModelId;
  messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  schema: ZodSchema;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export function createLLMRequest(
  modelId: DomainModelId,
  messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[],
  schema: ZodSchema,
  options: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stream?: boolean;
    metadata?: Record<string, unknown>;
  } = {},
): LLMRequest {
  return {
    id: `llm-req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    modelId,
    messages,
    schema,
    ...options,
  };
}
