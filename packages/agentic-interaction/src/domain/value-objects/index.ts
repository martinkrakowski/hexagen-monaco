export type { VaultState, VaultStatus } from "./vault-state.vo.js";
export type { VaultError } from "./vault-error.vo.js";

// Phase 9.2: Manifest generation value objects
export type {
  ProjectDescription,
  ValidationError,
  ValidationResult,
} from "./project-description";
export {
  ProjectDescriptionValidator,
  createProjectDescription,
} from "./project-description";

export type {
  GeneratedManifest,
  GenerationMetadata,
} from "./generated-manifest";
export {
  GeneratedManifestValidator,
  createGeneratedManifest,
} from "./generated-manifest";
