export type ArchitectureType =
  | "modular-monolith"
  | "microservices"
  | "monolith";

export interface Manifest {
  system?: string;
  scope?: string;
  architecture?: ArchitectureType;
  monorepo?: import("./monorepo.js").MonorepoConfig;
  generator?: import("./generator.js").GeneratorConfig;
  workspaceDefaults?: import("./monorepo.js").WorkspaceDefaults;
  bounded_contexts?: import("./bounded-context.js").BoundedContext[];
  apps?: import("./apps.js").App[];
  [key: string]: unknown;
}

export type InvariantPriority = "critical" | "high" | "medium" | "low";
export type FailureBehavior =
  | "abort-and-cleanup"
  | "abort"
  | "warn-and-continue";

export interface Invariant {
  name: string;
  description?: string;
  priority: InvariantPriority;
  enforcement?: "bootstrap" | "generation-time" | "runtime";
  failure: FailureBehavior;
}

export interface OwnershipRegistry {
  ports: Record<string, string>;
}

export interface GeneratorGlobalConfig {
  version?: string;
  description?: string;
  invariants?: Invariant[];
  "bootstrap-sequence"?: string[];
  "failure-behavior"?: Record<InvariantPriority, FailureBehavior>;
  "ownership-registry"?: OwnershipRegistry;
}

export type PlaneType =
  | "projection"
  | "probabilistic"
  | "infrastructure"
  | "shared-kernel"
  | "core"
  | "supporting";

export interface IndexBoundedContextEntry {
  name: string;
  type: string;
  plane?: string;
  status?: string;
  file: string;
  frozen_since?: string;
}

export interface IndexAppEntry {
  name: string;
  file?: string;
}

export interface IndexManifest {
  version?: string;
  system?: string;
  scope?: string;
  planes?: Record<string, string[]>;
  bounded_contexts?: IndexBoundedContextEntry[];
  apps?: IndexAppEntry[];
  invariants?: Record<string, string>;
  governance?: Record<string, string>;
  agent_instructions?: Record<string, unknown>;
  relationship_patterns?: Record<
    string,
    {
      description: string;
      acl_required?: boolean | "optional";
      linter?: string;
    }
  >;
}
