import type { AnswerMap } from "./question.js";

export interface TemplateInstallRecord {
  /** ISO-8601 timestamp */
  installedAt: string;
  version: string;
  answers: AnswerMap;
  /**
   * Paths of files emitted by this template, relative to the project root.
   * Used for conflict detection: if a file's SHA-256 matches the stored hash, it
   * hasn't been user-modified and can be safely overwritten.
   */
  generatedFiles: GeneratedFileRecord[];
}

export interface GeneratedFileRecord {
  path: string;
  /** SHA-256 hex digest of the file content at time of generation */
  contentHash: string;
}

export interface TemplateConfig {
  /** Schema version for future migrations */
  schemaVersion: "1";
  templates: Record<string, TemplateInstallRecord>;
}

export const TEMPLATE_CONFIG_FILE = ".hexagen-template-config.json";

export function emptyConfig(): TemplateConfig {
  return { schemaVersion: "1", templates: {} };
}

export function isInstalled(
  config: TemplateConfig,
  templateId: string,
): boolean {
  return templateId in config.templates;
}

/**
 * The three-state reading of a template config record (plan F-D7): `absent` —
 * no record exists, so the project's add-on history is unknown and a query
 * path must never report it as "no templates"; `empty` — the record exists and
 * lists no add-on templates; `populated` — the record exists and carries
 * install records.
 */
export type TemplateConfigState =
  | { state: "absent" }
  | { state: "empty" }
  | { state: "populated"; config: TemplateConfig };

/**
 * Classifies a config value already read from some source. Whether a record
 * exists at all (`absent` vs the rest) is a property of the source, not of the
 * value, so the store adapters decide that side.
 */
export function configState(config: TemplateConfig): TemplateConfigState {
  return Object.keys(config.templates).length === 0
    ? { state: "empty" }
    : { state: "populated", config };
}
