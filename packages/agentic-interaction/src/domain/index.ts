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
  WORKSPACE_SYSTEM_PROMPT,
  compileWorkspacePrompt,
  CONTEXT_LIST_SYSTEM_PROMPT,
  compileContextListPrompt,
  PORTS_LIST_SYSTEM_PROMPT,
  compilePortsPrompt,
  ADAPTERS_LIST_SYSTEM_PROMPT,
  compileAdaptersPrompt,
  RETRY_PROMPTS,
  type PromptVariables,
  type RetryResult,
} from "./prompts/index.js";
export {
  TOPOLOGY_SYSTEM_PROMPT,
  compileTopologyUserPrompt,
  type TopologyPromptVariables,
} from "./prompts/index.js";
export {
  ADAPTER_SYSTEM_PROMPT,
  compileAdapterUserPrompt,
  type AdapterPromptVariables,
} from "./prompts/index.js";

// Manifest draft pipeline exports
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
