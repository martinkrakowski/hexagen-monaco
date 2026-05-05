export * from "./HandleServerChatUseCase.js";
export { ModifyArchitectureUseCase } from "./modify-architecture.use-case.js";
export type { ModifyArchitectureDeps } from "./modify-architecture.use-case.js";

// Phase 9.3: Manifest generation use case
export { GenerateManifestFromDescriptionUseCase } from "./generate-manifest-from-description.use-case.js";
export { ExecutePromptNormalizationUseCase } from "./staged-generation/execute-prompt-normalization.use-case.js";
export { ExecuteDomainExtractionUseCase } from "./staged-generation/execute-domain-extraction.use-case.js";
export { ExecuteContextClassificationUseCase } from "./staged-generation/execute-context-classification.use-case.js";
export { ExecutePortMappingUseCase } from "./staged-generation/execute-port-mapping.use-case.js";
export { ExecuteAdapterAssignmentUseCase } from "./staged-generation/execute-adapter-assignment.use-case.js";
export { ExecuteManifestAssemblyUseCase } from "./staged-generation/execute-manifest-assembly.use-case.js";
export { ExecuteValidationReviewUseCase } from "./staged-generation/execute-validation-review.use-case.js";
export { ExecuteStagedGenerationUseCase } from "./staged-generation/execute-staged-generation.use-case.js";
export type { StagedGenerationCallbacks } from "./staged-generation/execute-staged-generation.use-case.js";
export {
  ManifestWarningCategory,
  type ManifestWarning,
  type GenerationDiagnostics,
  type GenerateManifestFromDescriptionRequest,
  type GenerateManifestFromDescriptionResponse,
} from "./generate-manifest-types.js";

// Auto-fix use cases
export {
  FixManifestViolationUseCase,
  type FixManifestViolationRequest,
  type FixManifestViolationResponse,
} from "./fix-manifest-violation.use-case.js";

export {
  HolisticManifestRepairUseCase,
  type HolisticManifestRepairRequest,
  type HolisticManifestRepairResponse,
} from "./holistic-manifest-repair.use-case.js";
