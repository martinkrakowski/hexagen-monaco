import type { Result } from "@hexagen/shared";
import type {
  LLMProgressCallback,
  ModelConfig,
  ModelMetadata,
} from "../value-objects/index.js";

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

export interface LocalLLMProviderPort {
  initialize(
    config: ModelConfig,
    onProgress: LLMProgressCallback,
  ): Promise<Result<void>>;
  complete(
    request: LLMCompletionRequest,
  ): Promise<Result<LLMCompletionResponse>>;
  streamComplete(request: LLMCompletionRequest): AsyncGenerator<Result<string>>;
  getLoadedModel(): ModelMetadata | null;
  dispose(): void;
}

export function isLocalLLMProviderPort(
  port: unknown,
): port is LocalLLMProviderPort {
  if (port === null || typeof port !== "object") return false;
  const p = port as Record<string, unknown>;
  return (
    typeof p.initialize === "function" &&
    typeof p.complete === "function" &&
    typeof p.streamComplete === "function" &&
    typeof p.getLoadedModel === "function" &&
    typeof p.dispose === "function"
  );
}
