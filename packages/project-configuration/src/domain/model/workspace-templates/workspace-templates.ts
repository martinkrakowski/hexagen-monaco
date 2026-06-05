export type CrossContextCallType = "in-process" | "event-bus" | "network";
export type StrictnessLevel = "flexible" | "strict";
export type WorkspaceTemplateId =
  | "modular-monolith"
  | "strict-enterprise"
  | "micro-frontend";

export interface WorkspaceTemplateRule {
  allowSharedUi: boolean;
  crossContextCalls: CrossContextCallType;
  strictness: StrictnessLevel;
}

export interface WorkspaceTemplate {
  id: WorkspaceTemplateId;
  title: string;
  description: string;
  rules: WorkspaceTemplateRule;
}

/**
 * Rules applied when a workspace-template id can't be resolved — e.g. a drifted
 * or legacy saved project carrying an unknown id (the IndexedDB load perimeter
 * preserves such values verbatim). Mirrors the flexible `modular-monolith`
 * defaults, so an unresolved template degrades to the safest, least-restrictive
 * behaviour rather than throwing. Shared by the catalog entry below and by
 * downstream consumers (e.g. wizard → manifest), so they all degrade
 * identically. See docs/planning/wire-architectural-template-into-generation.md.
 */
export const FALLBACK_RULES: WorkspaceTemplateRule = {
  allowSharedUi: true,
  crossContextCalls: "in-process",
  strictness: "flexible",
};

export const workspaceTemplates: WorkspaceTemplate[] = [
  {
    id: "modular-monolith",
    title: "Modular Monolith",
    description:
      "Logical separation with in-process communication. Contexts can be wired as direct package dependencies.",
    rules: FALLBACK_RULES,
  },
  {
    id: "strict-enterprise",
    title: "Strict Enterprise",
    description:
      "Zero-trust boundaries. Contexts may not depend on each other directly — the generated architectural invariants deny cross-context imports, so contexts integrate via an event bus.",
    rules: {
      allowSharedUi: false,
      crossContextCalls: "event-bus",
      strictness: "strict",
    },
  },
  {
    id: "micro-frontend",
    title: "Micro-Frontend Ready",
    description:
      "Strict isolation for future UI deployment autonomy. The generated invariants deny direct cross-context imports, so contexts integrate over the network.",
    rules: {
      allowSharedUi: false,
      crossContextCalls: "network",
      strictness: "strict",
    },
  },
];

export function getWorkspaceTemplate(
  id: string,
): WorkspaceTemplate | undefined {
  return workspaceTemplates.find((t) => t.id === id);
}
