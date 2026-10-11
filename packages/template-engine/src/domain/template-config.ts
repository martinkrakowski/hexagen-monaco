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
  return Object.hasOwn(config.templates, templateId);
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
 * The file records a template's entry holds after a re-add: every path the
 * earlier record listed, plus every path this run wrote. A path written in
 * this run takes this run's hash; a path only the earlier record lists keeps
 * its earlier hash (the emitter skipped it as a conflict, or this version no
 * longer emits it). Order: the earlier order first, then new paths in the
 * order this run wrote them. One record per path.
 */
export function mergeGeneratedFiles(
  earlier: unknown,
  current: GeneratedFileRecord[],
): GeneratedFileRecord[] {
  const validEarlier: GeneratedFileRecord[] = [];
  if (Array.isArray(earlier)) {
    for (const entry of earlier) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { path?: unknown }).path === "string" &&
        (entry as { path: string }).path !== "" &&
        typeof (entry as { contentHash?: unknown }).contentHash === "string"
      ) {
        validEarlier.push({
          path: (entry as { path: string }).path,
          contentHash: (entry as { contentHash: string }).contentHash,
        });
      }
    }
  }

  // Last hash per path wins in each input.
  const lastEarlierHash = new Map<string, string>();
  for (const entry of validEarlier) {
    lastEarlierHash.set(entry.path, entry.contentHash);
  }
  const currentHash = new Map<string, string>();
  for (const entry of current) {
    currentHash.set(entry.path, entry.contentHash);
  }

  const seen = new Set<string>();
  const merged: GeneratedFileRecord[] = [];
  for (const entry of validEarlier) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    merged.push({
      path: entry.path,
      contentHash:
        currentHash.get(entry.path) ?? lastEarlierHash.get(entry.path)!,
    });
  }
  for (const [path, contentHash] of currentHash) {
    if (seen.has(path)) continue;
    seen.add(path);
    merged.push({ path, contentHash });
  }
  return merged;
}

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
