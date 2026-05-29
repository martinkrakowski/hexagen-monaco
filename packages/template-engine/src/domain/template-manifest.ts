import type { TemplateQuestion } from "./question.js";

export interface TemplateManifest {
  /** Unique kebab-case identifier, e.g. "rate-limiting" */
  id: string;
  /** Human-readable name */
  name: string;
  description: string;
  version: string;
  /** IDs of templates that must be applied before this one */
  requires: string[];
  /** IDs of templates that cannot coexist with this one */
  conflicts: string[];
  questions: TemplateQuestion[];
  /** Env var names this template introduces (for validate command) */
  envVars: string[];
  /** Relative paths (within the target project) this template will write */
  outputs: string[];
  /** Post-install checklist items shown after successful apply */
  checklist: string[];
  /** Suggested git branch for implementation work */
  branch?: string;
}

export function validateManifest(raw: unknown): TemplateManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Template manifest must be a JSON object");
  }
  const m = raw as Record<string, unknown>;

  const required = ["id", "name", "description", "version"] as const;
  for (const field of required) {
    if (typeof m[field] !== "string" || !m[field]) {
      throw new Error(
        `Template manifest missing required string field: ${field}`,
      );
    }
  }

  return {
    id: m.id as string,
    name: m.name as string,
    description: m.description as string,
    version: m.version as string,
    requires: Array.isArray(m.requires) ? (m.requires as string[]) : [],
    conflicts: Array.isArray(m.conflicts) ? (m.conflicts as string[]) : [],
    questions: Array.isArray(m.questions)
      ? (m.questions as TemplateQuestion[])
      : [],
    envVars: Array.isArray(m.envVars) ? (m.envVars as string[]) : [],
    outputs: Array.isArray(m.outputs) ? (m.outputs as string[]) : [],
    checklist: Array.isArray(m.checklist) ? (m.checklist as string[]) : [],
    branch: typeof m.branch === "string" ? m.branch : undefined,
  };
}
