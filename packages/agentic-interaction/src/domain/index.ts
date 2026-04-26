export type {
  LLMProviderPort,
  LLMMessage,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "./ports/llm-provider.port.js";
export type {
  SuggestionEnginePort,
  SuggestionContext,
  AISuggestion,
  SuggestionRequest,
} from "./ports/suggestion-engine.port.js";
export type {
  CloudLLMProviderPort,
  CloudLLMMessage,
  CloudLLMCompletionRequest,
  CloudLLMCompletionResponse,
} from "./ports/cloud-llm-provider.port.js";
export { isCloudLLMProviderPort } from "./ports/cloud-llm-provider.port.js";
export type {
  VaultState,
  VaultStatus,
  VaultError,
} from "./value-objects/index.js";
export type {
  CloudProviderEndpoint,
  ProviderFallbackChain,
  ResolvedProvider,
} from "./provider-config.js";
export {
  resolveApiKey,
  resolveFallbackChain,
  createDefaultFallbackChain,
} from "./provider-config.js";
