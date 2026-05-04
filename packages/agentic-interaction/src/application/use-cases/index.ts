export * from "./HandleServerChatUseCase.js";
export { ModifyArchitectureUseCase } from "./modify-architecture.use-case.js";
export type { ModifyArchitectureDeps } from "./modify-architecture.use-case.js";

// Phase 9.3: Manifest generation use case
export { GenerateManifestFromDescriptionUseCase } from "./generate-manifest-from-description.use-case.js";
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
