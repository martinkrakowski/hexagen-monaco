export { LLMRouter } from "./router/llm-router";
export type { CallType, LLMRouterOptions } from "./router/llm-router";

export { registerProvider } from "./router/provider-registry";
export type {
  ProviderModels,
  ProviderRegistration,
} from "./router/provider-registry";

export { XaiLLMClientAdapter } from "./adapters/xai-llm-client.adapter";
export { OpenAILLMClientAdapter } from "./adapters/openai-llm-client.adapter";
export { AnthropicLLMClientAdapter } from "./adapters/anthropic-llm-client.adapter";
export { OllamaLLMClientAdapter } from "./adapters/ollama-llm-client.adapter";
export { AzureOpenAILLMClientAdapter } from "./adapters/azure-openai-llm-client.adapter";

export { MODELS } from "./constants/models";
export type { Provider, ModelTier } from "./constants/models";
export {
  REASONING_CAPABLE_MODELS,
  VISION_CAPABLE_MODELS,
  isReasoningModel,
  isVisionModel,
} from "./constants/capabilities";

export {
  LLMError,
  LLMAuthError,
  LLMRateLimitError,
  LLMServiceError,
  LLMTimeoutError,
  LLMParsingError,
  isRetryable,
} from "./errors/llm-errors";
export type { LLMErrorKind } from "./errors/llm-errors";

export { withRetry } from "./utils/retry";
export { withTimeout } from "./utils/timeout";
export { callStructured } from "./utils/structured-output";
export { parseIntSafe } from "./utils/parse-env";
