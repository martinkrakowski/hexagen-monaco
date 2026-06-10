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
  preferredCloudModel?: string;
  guidedJsonSchema?: Record<string, unknown>;
  /**
   * JSON Schema describing ONE line of an NDJSON response. Set by stages
   * whose prompts ask for NDJSON output. Providers that support structured
   * outputs (currently Inception/Mercury) may use it to enforce the line
   * shape via `response_format` (wrapped in an array client-side); all other
   * providers ignore it.
   */
  ndjsonLineSchema?: Record<string, unknown>;
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
    preferredCloudModel?: string;
    guidedJsonSchema?: Record<string, unknown>;
    ndjsonLineSchema?: Record<string, unknown>;
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
