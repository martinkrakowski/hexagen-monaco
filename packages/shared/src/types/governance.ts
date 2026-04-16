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

export const workspaceTemplates: WorkspaceTemplate[] = [
  {
    id: "modular-monolith",
    title: "Modular Monolith",
    description:
      "Logical separation with in-process communication. Contexts can be wired as direct package dependencies.",
    rules: {
      allowSharedUi: true,
      crossContextCalls: "in-process",
      strictness: "flexible",
    },
  },
  {
    id: "strict-enterprise",
    title: "Strict Enterprise",
    description:
      "Zero-trust boundaries. Contexts cannot depend on each other directly and must communicate via network or event bus.",
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
      "Strict isolation mapped for future UI deployment autonomy. Networked boundaries enforced.",
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
