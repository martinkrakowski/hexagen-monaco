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
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
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
  AggregateRoot,
  DomainEntity,
  DomainValueObject,
  DomainEvent,
  DomainAnalysis,
  ClassifiedContext,
  AcceptedContext,
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
} from "./pipeline-state.js";

// Phase P17: Stage telemetry
export type { StageTelemetry } from "./stage-telemetry.js";
export { estimateTokenCount } from "./stage-telemetry.js";
