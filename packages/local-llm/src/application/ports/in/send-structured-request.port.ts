import type { Result } from "@hexagen/shared";
import type { LLMRequest } from "../../../domain/value-objects/llm-request.vo.js";
import type { LLMResponse } from "../../../domain/value-objects/llm-response.vo.js";
import { z } from "zod";

export const FreeFormStringSchema = z.string();

export interface SendStructuredRequestPort {
  sendRequest(request: LLMRequest): Promise<Result<LLMResponse>>;
  streamStructuredRequest(request: LLMRequest): AsyncGenerator<Result<string>>;
}

export function isSendStructuredRequestPort(
  port: unknown,
): port is SendStructuredRequestPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return typeof p.sendRequest === "function";
}
