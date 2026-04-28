export * from "./HandleServerChatUseCase.js";
export { ModifyArchitectureUseCase } from "./modify-architecture.use-case.js";
export type { ModifyArchitectureDeps } from "./modify-architecture.use-case.js";

// Phase 9.3: Manifest generation use case
export {
  GenerateManifestFromDescriptionUseCase,
  type GenerateManifestFromDescriptionRequest,
  type GenerateManifestFromDescriptionResponse,
} from "./generate-manifest-from-description.use-case";
