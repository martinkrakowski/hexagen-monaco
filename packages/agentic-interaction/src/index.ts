// Domain exports
export type {
  LLMProviderPort,
  LLMMessage,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "./domain/ports/llm-provider.port.js";
export type {
  SuggestionEnginePort,
  SuggestionContext,
  AISuggestion,
  SuggestionRequest,
} from "./domain/ports/suggestion-engine.port.js";
export type {
  CloudLLMProviderPort,
  CloudLLMMessage,
  CloudLLMCompletionRequest,
  CloudLLMCompletionResponse,
} from "./domain/ports/cloud-llm-provider.port.js";
export { isCloudLLMProviderPort } from "./domain/ports/cloud-llm-provider.port.js";
export type {
  VaultState,
  VaultStatus,
  VaultError,
  ProjectDescription,
  ValidationError,
  ValidationResult,
  GeneratedManifest,
  GenerationMetadata,
} from "./domain/value-objects/index.js";
export {
  ProjectDescriptionValidator,
  createProjectDescription,
  GeneratedManifestValidator,
  createGeneratedManifest,
} from "./domain/value-objects/index.js";
export type {
  CloudProviderEndpoint,
  ProviderFallbackChain,
  ResolvedProvider,
  SecretVaultPort,
} from "./domain/provider-config.js";
export {
  resolveApiKey,
  resolveFallbackChain,
  createDefaultFallbackChain,
} from "./domain/provider-config.js";

// Application exports
export type {
  ServerLLMRequestPort,
  ServerLLMRequest,
  ServerLLMUserInfo,
  ArchitectureModificationPort,
  ModificationResult,
} from "./application/ports/index.js";
export { GenerateSuggestionUseCase } from "./application/use-cases/generate-suggestion.use-case.js";
export { SecureChatDispatchUseCase } from "./application/use-cases/secure-chat-dispatch.use-case.js";
export { HandleServerChatUseCase } from "./application/use-cases/index.js";
export { ModifyArchitectureUseCase } from "./application/use-cases/modify-architecture.use-case.js";
export type { ModifyArchitectureDeps } from "./application/use-cases/modify-architecture.use-case.js";
export {
  GenerateManifestFromDescriptionUseCase,
  type GenerateManifestFromDescriptionRequest,
  type GenerateManifestFromDescriptionResponse,
} from "./application/use-cases/index.js";
export {
  serializeProjectContext,
  buildContextForLLM,
} from "./application/context-serializer.js";
export type {
  ProjectContextInput,
  ProjectSummary,
  ContextSerializerOptions,
} from "./application/context-serializer.js";

// Infrastructure exports
export { ServerLLMAdapter } from "./infrastructure/adapters/server-llm.adapter.js";
export { OpenAICompatibleAdapter } from "./infrastructure/adapters/openai-compatible.adapter.js";
export {
  InMemoryNLParserAdapter,
  InMemoryPromptCompilerAdapter,
  InMemoryLLMSenderAdapter,
  InMemoryReconciliationAdapter,
  InMemoryManifestMutationAdapter,
  InMemoryLintValidationAdapter,
} from "./infrastructure/adapters/in-memory-pipeline-ports.adapter.js";
export {
  CloudLLMPipelineAdapter,
  type CloudLLMPipelineAdapterConfig,
} from "./infrastructure/adapters/cloud-llm-pipeline.adapter.js";
export {
  LLMProviderSelectorAdapter,
  type LLMProviderSelectorAdapterConfig,
} from "./infrastructure/adapters/llm-provider-selector.adapter.js";
export { EnvironmentSecretVaultAdapter } from "./infrastructure/adapters/environment-secret-vault.adapter.js";

// Phase1: Manifest YAML extractor exports (from domain)
export {
  extractManifestYaml,
  generateSuggestions,
  detectWarnings,
} from "./domain/index.js";

// Phase2: Prompt exports (from domain)
export {
  SYSTEM_PROMPT,
  compileUserPrompt,
} from "./domain/index.js";
export type {
  PromptVariables,
} from "./domain/index.js";
