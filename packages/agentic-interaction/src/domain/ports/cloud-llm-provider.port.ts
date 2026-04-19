import type { Result } from "@hexagen/shared";

export interface CloudLLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CloudLLMCompletionRequest {
  model: string;
  messages: CloudLLMMessage[];
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CloudLLMCompletionResponse {
  id: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface CloudLLMProviderPort {
  complete(
    request: CloudLLMCompletionRequest,
  ): Promise<Result<CloudLLMCompletionResponse, Error>>;

  streamComplete(
    request: CloudLLMCompletionRequest,
  ): AsyncGenerator<Result<string, Error>>;
}

export function isCloudLLMProviderPort(
  port: unknown,
): port is CloudLLMProviderPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return (
    typeof p.complete === "function" && typeof p.streamComplete === "function"
  );
}
