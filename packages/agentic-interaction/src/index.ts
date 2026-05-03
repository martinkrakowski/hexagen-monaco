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
  FixManifestViolationUseCase,
  type FixManifestViolationRequest,
  type FixManifestViolationResponse,
  HolisticManifestRepairUseCase,
  type HolisticManifestRepairRequest,
  type HolisticManifestRepairResponse,
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
  WORKSPACE_SYSTEM_PROMPT,
  compileWorkspacePrompt,
  CONTEXT_LIST_SYSTEM_PROMPT,
  compileContextListPrompt,
  PORTS_LIST_SYSTEM_PROMPT,
  compilePortsPrompt,
  ADAPTERS_LIST_SYSTEM_PROMPT,
  compileAdaptersPrompt,
  RETRY_PROMPTS,
} from "./domain/index.js";
export type { PromptVariables } from "./domain/index.js";
export {
  TOPOLOGY_SYSTEM_PROMPT,
  compileTopologyUserPrompt,
} from "./domain/index.js";
export type { TopologyPromptVariables } from "./domain/index.js";
export {
  ADAPTER_SYSTEM_PROMPT,
  compileAdapterUserPrompt,
} from "./domain/index.js";
export type { AdapterPromptVariables } from "./domain/index.js";

// Phase3: Manifest draft pipeline exports (from domain)
export {
  ManifestDraftSchema,
  ManifestTopologyDraftSchema,
  ManifestDraftContextSchema,
  ManifestDraftPortSchema,
  ManifestDraftAdapterSchema,
  ManifestTopologyDraftContextSchema,
  ContextListSchema,
  PortsListSchema,
  MAX_BOUNDED_CONTEXTS_DRAFT,
  GENERIC_CONTEXT_NAMES,
} from "./domain/index.js";
export type {
  ManifestDraft,
  ManifestTopologyDraft,
  ContextListEntry,
  PortsList,
  ManifestDraftContext,
  ManifestDraftPort,
  ManifestDraftAdapter,
  ManifestTopologyDraftContext,
  DraftDiagnostic,
  DraftValidationResult,
  ClarificationTrigger,
  RenderedManifest,
} from "./domain/index.js";
export {
  normalizeDraft,
  normalizeTopologyDraft,
  toPascalCase,
  toKebabCase,
  ensurePortSuffix,
  normalizePortName,
} from "./domain/index.js";
export { validateDraft, checkClarificationTriggers } from "./domain/index.js";
export { draftToManifest } from "./domain/index.js";
export type { ManifestOutput, ManifestContextOutput } from "./domain/index.js";
export {
  renderManifestYaml,
  renderDraft,
  verifyToken,
  extractJSON,
  parseJSON,
  extractArrayFromWrapper,
  extractObjectFromWrapper,
} from "./domain/index.js";
