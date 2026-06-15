export type {
  LLMProviderPort,
  LLMMessage,
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "./ports/llm-provider.port";
export type {
  SuggestionEnginePort,
  SuggestionContext,
  AISuggestion,
  SuggestionRequest,
} from "./ports/suggestion-engine.port";
export type {
  CloudLLMProviderPort,
  CloudLLMMessage,
  CloudLLMCompletionRequest,
  CloudLLMCompletionResponse,
} from "./ports/cloud-llm-provider.port";
export { isCloudLLMProviderPort } from "./ports/cloud-llm-provider.port";
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
} from "./value-objects/index";
export type {
  CloudProviderEndpoint,
  ProviderFallbackChain,
  ResolvedProvider,
  SecretVaultPort,
} from "./provider-config";
export {
  resolveApiKey,
  resolveFallbackChain,
  createDefaultFallbackChain,
} from "./provider-config";
export { generateSuggestions, detectWarnings } from "./manifest-yaml-extractor";
export {
  STAGE0_NORMALIZATION_SYSTEM_PROMPT,
  compileStage0Prompt,
  buildGreenfieldArchitectureContext,
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
  STAGE7_REPAIR_OPS_SYSTEM_PROMPT,
  compileStage7OpsPrompt,
  RETRY_PROMPTS,
  CONTEXT_LIST_SYSTEM_PROMPT,
  compileContextListPrompt,
  PORTS_LIST_SYSTEM_PROMPT,
  compilePortsPrompt,
  type PromptVariables,
  type RetryResult,
} from "./prompts/index";
export {
  TOPOLOGY_SYSTEM_PROMPT,
  compileTopologyUserPrompt,
} from "./prompts/index";
export type { TopologyPromptVariables } from "./prompts/index";
export type { ArchitectureContext } from "./prompts/index";
export {
  ADAPTER_SYSTEM_PROMPT,
  compileAdapterUserPrompt,
} from "./prompts/index";
export type { AdapterPromptVariables } from "./prompts/index";
export {
  CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT,
  compileClassifyContextTypePrompt,
} from "./prompts/index";

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
} from "./manifest/index";
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
} from "./manifest/index";
export {
  normalizeDraft,
  normalizeTopologyDraft,
  toPascalCase,
  toKebabCase,
  ensurePortSuffix,
  normalizePortName,
  normalizeContextName,
} from "./manifest/index";
export { validateDraft, checkClarificationTriggers } from "./manifest/index";
export { draftToManifest } from "./manifest/index";
export type { ManifestOutput, ManifestContextOutput } from "./manifest/index";
export { renderManifestYaml, renderDraft, verifyToken } from "./manifest/index";
export {
  extractJSON,
  parseJSON,
  extractArrayFromWrapper,
  extractObjectFromWrapper,
} from "./manifest/index";

export {
  coerceRawTopology,
  coerceRawPorts,
  coerceContextName,
  coercePortName,
} from "./manifest/index";

export type { PortQualityIssue } from "./services/index";
export { validatePortQuality } from "./services/index";
