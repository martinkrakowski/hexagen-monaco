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
  NormalizedPrompt,
  DomainAnalysis,
  ClassifiedContext,
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
} from "./value-objects/index.js";
export type {
  CloudProviderEndpoint,
  ProviderFallbackChain,
  ResolvedProvider,
  SecretVaultPort,
} from "./provider-config.js";
export {
  resolveApiKey,
  resolveFallbackChain,
  createDefaultFallbackChain,
} from "./provider-config.js";
export {
  extractYamlFromResponse as extractManifestYaml,
  generateSuggestions,
  detectWarnings,
} from "./manifest-yaml-extractor.js";
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
  type PromptVariables,
  type RetryResult,
} from "./prompts/index.js";
export {
  TOPOLOGY_SYSTEM_PROMPT,
  compileTopologyUserPrompt,
} from "./prompts/index.js";
export type { TopologyPromptVariables } from "./prompts/index.js";
export {
  ADAPTER_SYSTEM_PROMPT,
  compileAdapterUserPrompt,
} from "./prompts/index.js";
export type { AdapterPromptVariables } from "./prompts/index.js";

// Manifest draft pipeline exports
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
} from "./manifest/index.js";
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
} from "./manifest/index.js";
export {
  normalizeDraft,
  normalizeTopologyDraft,
  toPascalCase,
  toKebabCase,
  ensurePortSuffix,
  normalizePortName,
} from "./manifest/index.js";
export { validateDraft, checkClarificationTriggers } from "./manifest/index.js";
export { draftToManifest } from "./manifest/index.js";
export type {
  ManifestOutput,
  ManifestContextOutput,
} from "./manifest/index.js";
export {
  renderManifestYaml,
  renderDraft,
  verifyToken,
} from "./manifest/index.js";
export {
  extractJSON,
  parseJSON,
  extractArrayFromWrapper,
  extractObjectFromWrapper,
} from "./manifest/index.js";

export {
  coerceRawTopology,
  coerceRawPorts,
  coerceContextName,
  coercePortName,
  extractYamlFromResponse,
} from "./manifest/index.js";
