import type { Identifier } from "@hexagen/shared";
import type { DomainModelId } from "./model-id.vo.js";

/**
 * LLMResponse value object — represents a response from an LLM.
 * Includes metadata for tracking and potential schema validation results.
 */
export interface LLMResponse {
  id: Identifier;
  modelId: DomainModelId;
  content: string;
  finishReason: "stop" | "length" | "content_filter" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Creates a new LLMResponse
 */
export function createLLMResponse(
  modelId: DomainModelId,
  content: string,
  finishReason: "stop" | "length" | "content_filter" | "error",
  options: {
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    metadata?: Record<string, unknown>;
    timestamp?: number;
  } = {},
): LLMResponse {
  return {
    id: `llm-resp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    modelId,
    content,
    finishReason,
    timestamp: options.timestamp ?? Date.now(),
    ...options,
  };
}
