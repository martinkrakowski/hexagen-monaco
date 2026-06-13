export * from "./HandleServerChatUseCase";
export { ModifyArchitectureUseCase } from "./modify-architecture.use-case";
export type { ModifyArchitectureDeps } from "./modify-architecture.use-case";

// Phase 9.3: Manifest generation use case
export { GenerateManifestFromDescriptionUseCase } from "./generate-manifest-from-description.use-case";
export { ExecutePromptNormalizationUseCase } from "./staged-generation/execute-prompt-normalization.use-case";
export { ExecuteDomainExtractionUseCase } from "./staged-generation/execute-domain-extraction.use-case";
export type {
  Stage1RefinementConfig,
  Stage1RefinementMode,
} from "./staged-generation/execute-domain-extraction.use-case";
export { ExecuteContextClassificationUseCase } from "./staged-generation/execute-context-classification.use-case";
export { ExecutePortMappingUseCase } from "./staged-generation/execute-port-mapping.use-case";
export type { PortMappingResult } from "./staged-generation/execute-port-mapping.use-case";
export { ExecuteAdapterAssignmentUseCase } from "./staged-generation/execute-adapter-assignment.use-case";
export { ExecuteManifestAssemblyUseCase } from "./staged-generation/execute-manifest-assembly.use-case";
export { ExecuteValidationReviewUseCase } from "./staged-generation/execute-validation-review.use-case";
export { ExecuteFullStagedGenerationUseCase } from "./staged-generation/execute-full-staged-generation.use-case";
export type {
  FullStagedGenerationCallbacks,
  FullStagedGenerationOptions,
} from "./staged-generation/execute-full-staged-generation.use-case";
export { ExecuteStructuredConfigGenerationUseCase } from "./staged-generation/execute-structured-config-generation.use-case";
export type {
  StructuredConfigGenerationCallbacks,
  StructuredConfigInput,
} from "./staged-generation/execute-structured-config-generation.use-case";
export {
  buildDomainAnalysisFromConfig,
  buildClassificationFromConfig,
  buildNormalizedPromptFromConfig,
  inferContextTypeWithConfidence,
} from "./staged-generation/execute-structured-config-generation.use-case";
export {
  ManifestWarningCategory,
  type ManifestWarning,
  type GenerationDiagnostics,
  type GenerateManifestFromDescriptionRequest,
  type GenerateManifestFromDescriptionResponse,
} from "./generate-manifest-types";

export {
  ExecuteLooseSpecConversionUseCase,
  MAX_LOOSE_SPEC_INPUT_CHARS,
  type LooseSpecConversionCallbacks,
} from "./staged-generation/execute-loose-spec-conversion.use-case";
export { ClassifyContextTypeUseCase } from "./staged-generation/classify-context-type.use-case";
export type { ClassifyContextTypePort } from "./staged-generation/classify-context-type.use-case";
