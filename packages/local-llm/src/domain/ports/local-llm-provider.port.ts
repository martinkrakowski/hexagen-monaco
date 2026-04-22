import type { Result } from "@hexagen/shared";
import type {
  DomainModelId,
  LLMInitializeConfig,
  LLMProgressCallback,
  ModelMetadata,
} from "../value-objects/index.js";

/** @internal Raw message shape — use SendStructuredRequestPort instead */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** @internal Raw completion request — use LLMRequest via SendStructuredRequestPort instead */
export interface LLMCompletionRequest {
  modelId: DomainModelId;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  stream?: boolean;
}

export interface LLMCompletionResponse {
  id: string;
  modelId: DomainModelId;
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

/** @internal Legacy monolith port — use ModelLifecyclePort + SendStructuredRequestPort instead */
export interface LocalLLMProviderPort {
  initialize(
    config: LLMInitializeConfig,
    onProgress: LLMProgressCallback,
  ): Promise<Result<void>>;
  complete(
    request: LLMCompletionRequest,
  ): Promise<Result<LLMCompletionResponse>>;
  streamComplete(request: LLMCompletionRequest): AsyncGenerator<Result<string>>;
  getLoadedModel(): ModelMetadata | null;
  /**
   * Check whether a model's weights are cached locally (IndexedDB or Cache API).
   * Runs on the main thread — the adapter proxies this to the worker, which
   * has access to WebLLM's cache utility functions.
   */
  hasModelInCache(modelId: DomainModelId): Promise<boolean>;
  /**
   * Delete all cached data for a model (weights + WASM + config).
   * After deletion, the model must be re-downloaded if selected again.
   * Returns Result.success if deletion succeeded or cache was already empty.
   * Returns Result.error if deletion failed (timeout, I/O error, etc).
   */
  deleteCachedModel(modelId: DomainModelId): Promise<Result<void>>;
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
    typeof p.hasModelInCache === "function" &&
    typeof p.deleteCachedModel === "function" &&
    typeof p.dispose === "function"
  );
}
