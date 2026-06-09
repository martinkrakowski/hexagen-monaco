// Public (client-safe) barrel.
//
// Intentionally EXCLUDES `./infrastructure` because infrastructure adapters
// pull in Node-only modules (node:fs/promises, node:path, js-yaml) that
// cannot be bundled into a client-side build. Server-only consumers should
// import from `@hexagen/project-configuration/server` instead.
//
// See AGENTS.md §5 (hexagonal boundary — infrastructure must not leak into
// the UI layer) for the rationale.
export * from "./domain";
export * from "./application";
// Export types from schema
export type {
  WorkspaceGovernance,
  PortConfiguration,
  PeerContextMapping,
  BoundedContext,
  ExternalContext,
  ProjectSpec,
  // Wizard domain aliases (for consolidated schema management)
  WizardData,
  WizardGovernance,
  ContextRelationshipType,
  DomainEventRef,
  PeerMapping,
} from "./schema";
// Re-export schema constants
export { PortConfigurationSchema } from "./schema";
// Re-export manifest schema types for consumers
export {
  BoundedContextTypeSchema,
  LayerTypeSchema,
  ManifestSchema,
  PLANE_NAMES,
  PlaneTypeSchema,
  StatusTypeSchema,
  RelationshipPatternSchema,
  RelationshipRoleSchema,
  RelationshipSchema,
  PortDefinitionSchema,
  LegacyOrNewPortSchema,
  BoundedContextSchema,
  IndexManifestSchema,
} from "./domain/model/manifest-schema/manifest-schema";
export type {
  Manifest,
  PortDefinition,
  Relationship,
  IndexManifest,
  PlaneType,
  IndexBoundedContextEntry,
  ManifestBoundedContext,
  App,
} from "./domain/model/manifest-schema/manifest-schema";
export { AppSchema } from "./domain/model/manifest-schema/manifest-schema";
export { WorkspaceConfigSchema } from "./domain/model/workspace-config/workspace-config.schema";
export type { WorkspaceConfig } from "./domain/model/workspace-config/workspace-config.schema";
export { isIndexManifest } from "./domain/model/manifest-schema/index.js";
// Re-export manifest-diff utilities
export type {
  ManifestDiff,
  DiffEntry,
} from "./domain/model/manifest-diff/manifest-diff";
export {
  computeDiff,
  formatDiff,
} from "./domain/model/manifest-diff/manifest-diff";
// Re-export workspace templates
export type {
  WorkspaceTemplateId,
  WorkspaceTemplate,
  WorkspaceTemplateRule,
  CrossContextCallType,
  StrictnessLevel,
} from "./domain/model/workspace-templates/workspace-templates";
export {
  workspaceTemplates,
  getWorkspaceTemplate,
  FALLBACK_RULES,
} from "./domain/model/workspace-templates/workspace-templates";
