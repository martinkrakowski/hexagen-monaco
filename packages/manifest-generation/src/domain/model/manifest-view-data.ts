export interface PortEntry {
  name: string;
  hasIssue: boolean;
  issueMessage?: string;
}

export interface AdapterEntry {
  name: string;
  implements?: string;
  hasIssue: boolean;
  issueMessage?: string;
}

export interface BoundedContextView {
  name: string;
  // The full canonical context-type vocabulary. `shared-kernel` and `generic`
  // are real manifest types (DDD context taxonomy) — earlier this union omitted
  // them, so the parser coerced both to "supporting", mislabeling cards and the
  // AI grounding. See manifest-view-data-parser.
  type: "core" | "supporting" | "generic" | "shared-kernel" | "driver";
  description: string;
  colorToken: string;
  portsIn: PortEntry[];
  portsOut: PortEntry[];
  adapters: AdapterEntry[];
  health: "healthy" | "warning" | "error";
  healthReasons: string[];
  yamlLineRange: { start: number; end: number };
}

export interface ManifestViewData {
  system: string;
  scope: string;
  architecture: string;
  contexts: BoundedContextView[];
  validationItems: ValidationItem[];
  overallScore: number;
}

/**
 * Bounded, machine-stable identifiers for every validation item the parser
 * emits (repair-telemetry plan P0). Derived from the emit sites in
 * manifest-view-data-parser.ts — one code per class, no user data in the
 * values. `title`/`description` remain the human-readable rendering and may
 * interpolate user content; the CODE is what machines (the fixer allow-list,
 * telemetry) key on. Titles are unbounded (they carry bounded-context names),
 * so they can never be a dimension: persisting one stores user architecture
 * (privacy) and never aggregates (cardinality).
 */
export const VIOLATION_CODES = [
  "invalid-yaml",
  "scope-missing",
  "scope-defined",
  "architecture-missing",
  "architecture-declared",
  "context-name-hyphen",
  "yaml-tag-indicator",
  "zero-adapters",
  "unconnected-ports",
  "ports-connected",
  "interface-contract-met",
  "interface-contract-missing-ports",
] as const;
export type ViolationCode = (typeof VIOLATION_CODES)[number];

export interface ValidationItem {
  status: "pass" | "warn" | "fail";
  /** Bounded machine identifier — the only field telemetry may persist. */
  code: ViolationCode;
  title: string;
  description: string;
  contextName?: string;
}
