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
    requires: validatedStringArray(m.requires, "requires"),
    conflicts: validatedStringArray(m.conflicts, "conflicts"),
    questions: validatedQuestions(m.questions),
    envVars: validatedStringArray(m.envVars, "envVars"),
    outputs: validatedStringArray(m.outputs, "outputs"),
    checklist: validatedStringArray(m.checklist, "checklist"),
    branch: typeof m.branch === "string" ? m.branch : undefined,
  };
}

function validatedStringArray(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) return [];
  for (const el of raw) {
    if (typeof el !== "string") {
      throw new Error(
        `Template manifest field '${field}' must be an array of strings`,
      );
    }
  }
  return raw as string[];
}

function validatedQuestions(raw: unknown): TemplateQuestion[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set([
    "select",
    "multiselect",
    "text",
    "boolean",
    "auto",
  ]);
  for (const q of raw) {
    if (!q || typeof q !== "object") {
      throw new Error("Template manifest: each question must be an object");
    }
    const qObj = q as Record<string, unknown>;
    if (typeof qObj.id !== "string" || !qObj.id) {
      throw new Error(
        "Template manifest: each question must have a string 'id'",
      );
    }
    if (typeof qObj.type !== "string" || !validTypes.has(qObj.type)) {
      throw new Error(
        `Template manifest: question '${qObj.id}' has invalid type '${qObj.type}'`,
      );
    }
  }
  return raw as TemplateQuestion[];
}
