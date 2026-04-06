import type { Result } from "@hexagen/shared";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletionRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LLMCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    message: LLMMessage;
    finishReason: string;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProviderPort {
  complete(
    request: LLMCompletionRequest,
  ): Promise<Result<LLMCompletionResponse>>;
  streamComplete(request: LLMCompletionRequest): AsyncGenerator<Result<string>>;
}
