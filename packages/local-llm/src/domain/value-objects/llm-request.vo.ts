import type { Identifier } from "@hexagen/shared";
import type { DomainModelId } from "./model-id.vo.js";

/**
 * LLMRequest value object — represents a structured request to an LLM.
 * Enforces ACL by ensuring all LLM inputs come through prompt-compiler's
 * structured request port with schema validation.
 */
export interface LLMRequest {
  id: Identifier;
  modelId: DomainModelId;
  messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  schema: unknown; // Zod schema or similar for structured output validation
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Creates a new LLMRequest with validation
 */
export function createLLMRequest(
  modelId: DomainModelId,
  messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[],
  schema: unknown,
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
