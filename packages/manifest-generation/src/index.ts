export { deriveWorkspaceName } from "./domain/value-objects/index.js";
export type {
  WorkspaceNameDeriverInput,
  WorkspaceNameDeriverOutput,
} from "./domain/value-objects/index.js";
export {
  ClientManifestGenerationUseCase,
  ServerManifestGenerationUseCase,
} from "./application/use-cases/index.js";
export type {
  ClientManifestGenerationPort,
  ClientManifestGenerationInput,
  ClientManifestGenerationResult,
  ClientManifestGenerationTopologyResult,
  ClientManifestGenerationAdaptersResult,
  ClientManifestGenerationAdaptersPhaseResult,
  ClientManifestGenerationWarning,
  ClientManifestGenerationDeps,
  ManifestGenerationPort,
  ManifestGenerationOptions,
  ManifestGenerationResult,
  ManifestGenerationError,
  ManifestGenerationResponse,
} from "./application/ports/in/index.js";
export { LocalLlmGenerationAdapter } from "./infrastructure/adapters/index.js";
export type { LocalLlmMessagingPort } from "./application/ports/out/index.js";
export { parseYamlToViewData } from "./domain/services/manifest-view-data-parser.js";
export {
  canAutoFix,
  applyDeterministicFix,
} from "./domain/services/manifest-violation-fixer.js";
export type {
  ManifestViewData,
  BoundedContextView,
  PortEntry,
  AdapterEntry,
  ValidationItem,
} from "./domain/model/manifest-view-data.js";
export {
  validateApiKeyFormat,
  isValidProvider,
} from "./domain/services/api-key-validation-service.js";
export { classifyGenerationError } from "./domain/services/generation-error-handler.js";
export type {
  ClassifiedError,
  ErrorClassificationCode,
} from "./domain/services/generation-error-handler.js";
export { assessModelCapability } from "./application/index.js";
export type { ManifestCapabilityAssessment } from "./application/index.js";
