export type { VaultState, VaultStatus } from "./vault-state.vo.js";
export type { VaultError } from "./vault-error.vo.js";

// Phase 9.2: Manifest generation value objects
export type {
  ProjectDescription,
  ValidationError,
  ValidationResult,
} from "./project-description.js";
export {
  ProjectDescriptionValidator,
  createProjectDescription,
} from "./project-description.js";

export type {
  GeneratedManifest,
  GenerationMetadata,
} from "./generated-manifest.js";
export {
  GeneratedManifestValidator,
  createGeneratedManifest,
} from "./generated-manifest.js";

export type {
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
  AssembledManifest,
  ValidationReport,
  PipelineState,
} from "./pipeline-state.js";
