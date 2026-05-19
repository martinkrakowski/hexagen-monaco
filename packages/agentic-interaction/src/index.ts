// Domain exports
export type { BoundedContextType } from "./domain/manifest/coerce-raw-topology";
export {
  coerceContextType,
  coercePort,
} from "./domain/manifest/coerce-raw-topology";
export type {
  LLMProviderPort,
  LLMMessage,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "./domain/ports/llm-provider.port";
export type {
  SuggestionEnginePort,
  SuggestionContext,
  AISuggestion,
  SuggestionRequest,
} from "./domain/ports/suggestion-engine.port";
export type {
  CloudLLMProviderPort,
  CloudLLMMessage,
  CloudLLMCompletionRequest,
  CloudLLMCompletionResponse,
} from "./domain/ports/cloud-llm-provider.port";
export { isCloudLLMProviderPort } from "./domain/ports/cloud-llm-provider.port";
export type {
  VaultState,
  VaultStatus,
  VaultError,
  ProjectDescription,
  ValidationError,
  ValidationResult,
  GeneratedManifest,
  GenerationMetadata,
  StageTelemetry,
} from "./domain/value-objects/index";
export {
  ProjectDescriptionValidator,
  createProjectDescription,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  GeneratedManifestValidator,
  createGeneratedManifest,
} from "./domain/value-objects/index";
export type {
  NormalizedPrompt,
  AggregateRoot,
  DomainEntity,
  DomainValueObject,
  DomainEvent,
  DomainAnalysis,
  ClassifiedContext,
  AcceptedContext,
  RejectedContext,
  UncertainContext,
  ClassificationResult,
  InboundPortType,
  OutboundPortType,
  PortDefinition,
  ContextPorts,
  PortMap,
  AdapterBinding,
  ContextAdapters,
  AdapterBindings,
  AssemblyWarning,
  AssembledManifest,
  ValidationReport,
  ContextMappingEntry,
  PipelineState,
} from "./domain/value-objects/index";
export type {
  CloudProviderEndpoint,
  ProviderFallbackChain,
  ResolvedProvider,
  SecretVaultPort,
} from "./domain/provider-config";
export {
  resolveApiKey,
  resolveFallbackChain,
  createDefaultFallbackChain,
} from "./domain/provider-config";

// Application exports
export type {
  ServerLLMRequestPort,
  ServerLLMRequest,
  ServerLLMUserInfo,
  ArchitectureModificationPort,
  ModificationResult,
} from "./application/ports/index";
export { GenerateSuggestionUseCase } from "./application/use-cases/generate-suggestion.use-case";
export { SecureChatDispatchUseCase } from "./application/use-cases/secure-chat-dispatch.use-case";
export { HandleServerChatUseCase } from "./application/use-cases/index";
export { ModifyArchitectureUseCase } from "./application/use-cases/modify-architecture.use-case";
export type { ModifyArchitectureDeps } from "./application/use-cases/modify-architecture.use-case";
export {
  GenerateManifestFromDescriptionUseCase,
  type GenerateManifestFromDescriptionRequest,
  type GenerateManifestFromDescriptionResponse,
  ManifestWarningCategory,
  type ManifestWarning,
  type GenerationDiagnostics,
  FixManifestViolationUseCase,
  type FixManifestViolationRequest,
  type FixManifestViolationResponse,
  HolisticManifestRepairUseCase,
  type HolisticManifestRepairRequest,
  type HolisticManifestRepairResponse,
} from "./application/use-cases/index";
export { ExecutePromptNormalizationUseCase } from "./application/use-cases/staged-generation/execute-prompt-normalization.use-case";
export { ExecuteDomainExtractionUseCase } from "./application/use-cases/staged-generation/execute-domain-extraction.use-case";
export { ExecuteContextClassificationUseCase } from "./application/use-cases/staged-generation/execute-context-classification.use-case";
export { ExecutePortMappingUseCase } from "./application/use-cases/staged-generation/execute-port-mapping.use-case";
export type { PortMappingResult } from "./application/use-cases/staged-generation/execute-port-mapping.use-case";
export { ExecuteAdapterAssignmentUseCase } from "./application/use-cases/staged-generation/execute-adapter-assignment.use-case";
export { ExecuteManifestAssemblyUseCase } from "./application/use-cases/staged-generation/execute-manifest-assembly.use-case";
export { ExecuteValidationReviewUseCase } from "./application/use-cases/staged-generation/execute-validation-review.use-case";
export { ExecuteStagedGenerationUseCase } from "./application/use-cases/staged-generation/execute-staged-generation.use-case";
export type { StagedGenerationCallbacks } from "./application/use-cases/staged-generation/execute-staged-generation.use-case";
export { ExecuteStructuredConfigGenerationUseCase } from "./application/use-cases/staged-generation/execute-structured-config-generation.use-case";
export type {
  StructuredConfigGenerationCallbacks,
  StructuredConfigInput,
} from "./application/use-cases/staged-generation/execute-structured-config-generation.use-case";
export {
  buildDomainAnalysisFromConfig,
  buildClassificationFromConfig,
  buildNormalizedPromptFromConfig,
} from "./application/use-cases/staged-generation/execute-structured-config-generation.use-case";
export {
  serializeProjectContext,
  buildContextForLLM,
} from "./application/context-serializer";
export type {
  ProjectContextInput,
  ProjectSummary,
  ContextSerializerOptions,
} from "./application/context-serializer";

// Infrastructure exports
export { ServerLLMAdapter } from "./infrastructure/adapters/server-llm.adapter";
export { OpenAICompatibleAdapter } from "./infrastructure/adapters/openai-compatible.adapter";
export {
  InMemoryNLParserAdapter,
  InMemoryPromptCompilerAdapter,
  InMemoryLLMSenderAdapter,
  InMemoryReconciliationAdapter,
  InMemoryManifestMutationAdapter,
  InMemoryLintValidationAdapter,
} from "./infrastructure/adapters/in-memory-pipeline-ports.adapter";
export {
  CloudLLMPipelineAdapter,
  type CloudLLMPipelineAdapterConfig,
} from "./infrastructure/adapters/cloud-llm-pipeline.adapter";
export {
  LLMProviderSelectorAdapter,
  type LLMProviderSelectorAdapterConfig,
} from "./infrastructure/adapters/llm-provider-selector.adapter";
export { EnvironmentSecretVaultAdapter } from "./infrastructure/adapters/environment-secret-vault.adapter";

// Manifest YAML extractor exports (from domain)
export {
  extractManifestYaml,
  generateSuggestions,
  detectWarnings,
} from "./domain/index";

// Staged pipeline prompt exports (from domain)
export {
  STAGE0_NORMALIZATION_SYSTEM_PROMPT,
  compileStage0Prompt,
  buildIntentHeader,
  isStructuredConfigPipeline,
  STAGE1_DOMAIN_SYSTEM_PROMPT,
  compileStage1Prompt,
  STAGE2_CLASSIFICATION_SYSTEM_PROMPT,
  compileStage2Prompt,
  STAGE3_PORTS_SYSTEM_PROMPT,
  compileStage3Prompt,
  STAGE4_ADAPTERS_SYSTEM_PROMPT,
  compileStage4Prompt,
  STAGE6_VALIDATION_SYSTEM_PROMPT,
  compileStage6Prompt,
  RETRY_PROMPTS,
  CONTEXT_LIST_SYSTEM_PROMPT,
  compileContextListPrompt,
  PORTS_LIST_SYSTEM_PROMPT,
  compilePortsPrompt,
} from "./domain/index";
export type { PromptVariables, RetryResult } from "./domain/index";

// Topology/adapters prompt exports (from domain)
export {
  TOPOLOGY_SYSTEM_PROMPT,
  compileTopologyUserPrompt,
} from "./domain/index";
export type { TopologyPromptVariables } from "./domain/index";
export {
  ADAPTER_SYSTEM_PROMPT,
  compileAdapterUserPrompt,
} from "./domain/index";
export type { AdapterPromptVariables } from "./domain/index";

// Manifest draft pipeline exports (from domain)
export {
  ManifestDraftSchema,
  ManifestTopologyDraftSchema,
  ManifestDraftContextSchema,
  ManifestDraftPortSchema,
  ManifestDraftAdapterSchema,
  ManifestTopologyDraftContextSchema,
  ContextListSchema,
  createContextListSchema,
  PortsListSchema,
  MAX_BOUNDED_CONTEXTS_DRAFT,
  DEFAULT_MAX_BOUNDED_CONTEXTS,
  GENERIC_CONTEXT_NAMES,
} from "./domain/index";
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
} from "./domain/index";
export {
  normalizeDraft,
  normalizeTopologyDraft,
  toPascalCase,
  toKebabCase,
  ensurePortSuffix,
  normalizePortName,
} from "./domain/index";
export { validateDraft, checkClarificationTriggers } from "./domain/index";
export { draftToManifest } from "./domain/index";
export type { ManifestOutput, ManifestContextOutput } from "./domain/index";
export {
  renderManifestYaml,
  renderDraft,
  verifyToken,
  extractJSON,
  parseJSON,
  extractArrayFromWrapper,
  extractObjectFromWrapper,
  coerceRawPorts,
  extractYamlFromResponse,
} from "./domain/index";
