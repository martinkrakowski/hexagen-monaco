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
