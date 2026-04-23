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
} from "./schema";
