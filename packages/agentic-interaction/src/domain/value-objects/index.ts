export type { VaultState, VaultStatus } from "./vault-state.vo";
export type { VaultError } from "./vault-error.vo";

// Phase 9.2: Manifest generation value objects
export type {
  ProjectDescription,
  ValidationError,
  ValidationResult,
} from "./project-description";
export {
  ProjectDescriptionValidator,
  createProjectDescription,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from "./project-description";

export type {
  GeneratedManifest,
  GenerationMetadata,
} from "./generated-manifest";
export {
  GeneratedManifestValidator,
  createGeneratedManifest,
} from "./generated-manifest";

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
} from "./pipeline-state";

// Phase P17: Stage telemetry
export type { StageTelemetry } from "./stage-telemetry";
export {
  estimateTokenCount,
  formatModelChip,
  modelNameFromResponseMetadata,
} from "./stage-telemetry";
