import type { Result } from "@hexagen/shared";
import type { LLMRequest } from "../../../domain/value-objects/llm-request.vo.js";
import type { LLMResponse } from "../../../domain/value-objects/llm-response.vo.js";

/**
 * Port for sending structured requests to an LLM.
 * This is the inbound port for the local-llm bounded context that enforces
 * the ACL: all LLM inputs must come through this port after prompt compilation.
 */
export interface SendStructuredRequestPort {
  /**
   * Sends a structured request to the LLM provider.
   * @param request The structured request containing prompt and schema
   * @returns Result containing the LLM response or an error
   */
  sendRequest(request: LLMRequest): Promise<Result<LLMResponse>>;
}

/**
 * Type guard for SendStructuredRequestPort
 */
export function isSendStructuredRequestPort(
  port: unknown,
): port is SendStructuredRequestPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.sendRequest === "function";
}
