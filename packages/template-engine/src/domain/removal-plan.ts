import type { TemplateConfig } from "./template-config.js";
import { TEMPLATE_CONFIG_FILE } from "./template-config.js";
import { isContainedRelativePath } from "./output-path-safety.js";

/**
 * The removal decision for `hexagen remove <template>` (proposal
 * 2026-10-10, "The decided contract"): a PURE function from the registry
 * content, the manifests and the current hash of each recorded file to
 * what a removal would do. It touches no disk; a later lane executes the
 * plan. When in doubt it deletes less and refuses more.
 */

/** What is on disk at a recorded path, as the caller read it. */
export type RecordedFileState =
  | { kind: "absent" }
  | { kind: "file"; contentHash: string }
  /** A directory, a symlink, unreadable, or anything that is not a plain readable file. */
  | { kind: "other"; detail: string };

export interface RemovalPlanInput {
  config: TemplateConfig;
  templateId: string;
  /** `requires` of every template whose manifest could be loaded, by template id. */
  requiresById: ReadonlyMap<string, readonly string[]>;
  /** State per NORMALISED recorded path (see normaliseRecordedPath). A missing key is treated as `other`. */
  fileStates: ReadonlyMap<string, RecordedFileState>;
  force: boolean;
  keepFiles: boolean;
}

export type RemovalRefusal =
  | { kind: "dependents"; templates: string[] }
  | { kind: "unknown-dependents"; templates: string[] }
  | { kind: "unsafe-paths"; paths: string[] };

export type RemovalPlan =
  | { kind: "not-installed"; templateId: string }
  | { kind: "refused"; templateId: string; refusals: RemovalRefusal[] }
  | {
      kind: "remove";
      templateId: string;
      /** Normalised paths to delete, sorted. Empty when keepFiles. */
      deleteFiles: string[];
      /** The subset of deleteFiles whose hash differs from the record (only ever non-empty with force). */
      deleteChanged: string[];
      keptChanged: string[];
      keptShared: string[];
      keptOther: string[];
      keptByFlag: string[];
      alreadyAbsent: string[];
      /** Dependents that are now broken (only with force). */
      brokenDependents: string[];
      unknownDependents: string[];
      /** Entries of the record that were not `{ path: string, contentHash: string }`. */
      malformedRecords: number;
    };

/** A recorded path of one template, normalised, with every hash the record gives for it. */
export interface RecordedSafePath {
  path: string;
  /** The file counts as unchanged when its current hash equals ANY of these. */
  contentHashes: string[];
}

/**
 * Posix-normalises a recorded path ("./a//b/../c" -> "a/c"), or returns
 * null when it is unsafe: not contained in the project root, the root
 * itself, a NUL character, a segment that ends in a dot or a space or
 * holds a colon, the registry file (or one of its `.tmp.` copies) and
 * anything under `.git`, both in any letter case. Such a path is never touched, not
 * even with `--force`.
 */
export function normaliseRecordedPath(raw: string): string | null {
  if (raw.includes("\0")) return null;
  if (!isContainedRelativePath(raw)) return null;
  const stack: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  const normalised = stack.join("/");
  if (normalised === "") return null;
  for (const segment of stack) {
    // Windows drops trailing dots and spaces from a path component
    // (".git./config" IS ".git/config" there), and a colon names an
    // alternate data stream of the file before it. Neither spelling is one
    // an emitter records, so both are refused on every platform.
    if (segment.endsWith(".") || segment.endsWith(" ")) return null;
    if (segment.includes(":")) return null;
  }
  // The protected names are compared without case: on macOS and Windows
  // ".GIT/config" is the repository's own file.
  const folded = normalised.toLowerCase();
  const registry = TEMPLATE_CONFIG_FILE.toLowerCase();
  if (folded === registry || folded.startsWith(`${registry}.tmp.`)) {
    return null;
  }
  if (stack[0].toLowerCase() === ".git") return null;
  return normalised;
}

/**
 * The recorded paths of one template, normalised and de-duplicated, in
 * record order; plus the raw unsafe ones and the count of malformed
 * entries. Trusts no shape of a hand-edited registry: a missing record
 * or a non-array `generatedFiles` yields nothing safe, and only the
 * entries that are exactly `{ path: string, contentHash: string }` are
 * read. A path recorded twice keeps its first position and collects all
 * its hashes — the file counts as unchanged when it matches ANY of them.
 */
export function recordedPaths(
  config: TemplateConfig,
  templateId: string,
): {
  safe: RecordedSafePath[];
  unsafe: string[];
  malformed: number;
} {
  const templates = (config as { templates?: unknown } | null | undefined)
    ?.templates;
  if (typeof templates !== "object" || templates === null) {
    return { safe: [], unsafe: [], malformed: 0 };
  }
  if (!Object.hasOwn(templates, templateId)) {
    return { safe: [], unsafe: [], malformed: 0 };
  }
  const record: unknown = (templates as Record<string, unknown>)[templateId];
  const generatedFiles: unknown = (
    record as { generatedFiles?: unknown } | null | undefined
  )?.generatedFiles;
  if (!Array.isArray(generatedFiles)) {
    return { safe: [], unsafe: [], malformed: 1 };
  }
  const safe: RecordedSafePath[] = [];
  const unsafe: string[] = [];
  let malformed = 0;
  for (const entry of generatedFiles) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { path?: unknown }).path !== "string" ||
      typeof (entry as { contentHash?: unknown }).contentHash !== "string"
    ) {
      malformed += 1;
      continue;
    }
    const rawPath = (entry as { path: string }).path;
    const contentHash = (entry as { contentHash: string }).contentHash;
    const normalised = normaliseRecordedPath(rawPath);
    if (normalised === null) {
      if (!unsafe.includes(rawPath)) unsafe.push(rawPath);
      continue;
    }
    const existing = safe.find((candidate) => candidate.path === normalised);
    if (existing === undefined) {
      safe.push({ path: normalised, contentHashes: [contentHash] });
    } else if (!existing.contentHashes.includes(contentHash)) {
      existing.contentHashes.push(contentHash);
    }
  }
  return { safe, unsafe, malformed };
}

function sharedPathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

/**
 * The removal decision for one installed template. Refuses (naming the
 * reasons) while `--force` is absent and dependents or unknown
 * dependents exist, and always for unsafe recorded paths unless
 * `--keep-files` is set — an unsafe path is never touched, not even with
 * `--force`. Otherwise classifies every safe recorded path: shared with
 * another installed template, already absent, not a plain readable
 * file, changed (kept unless `--force`), or unchanged (deleted unless
 * `--keep-files`). Every list is sorted and duplicate-free; the input is
 * never mutated, and a malformed config never throws.
 */
export function planTemplateRemoval(input: RemovalPlanInput): RemovalPlan {
  const { config, templateId, requiresById, fileStates, force, keepFiles } =
    input;
  const templates = (config as { templates?: unknown } | null | undefined)
    ?.templates;
  if (
    typeof templates !== "object" ||
    templates === null ||
    !Object.hasOwn(templates, templateId)
  ) {
    return { kind: "not-installed", templateId };
  }
  const otherIds = Object.keys(templates).filter((id) => id !== templateId);
  const dependents: string[] = [];
  const unknownDependents: string[] = [];
  for (const id of otherIds) {
    const requires = requiresById.get(id);
    if (requires === undefined) {
      unknownDependents.push(id);
    } else if (requires.includes(templateId)) {
      dependents.push(id);
    }
  }
  dependents.sort();
  unknownDependents.sort();

  const { safe, unsafe, malformed } = recordedPaths(config, templateId);

  const refusals: RemovalRefusal[] = [];
  if (dependents.length > 0 && !force) {
    refusals.push({ kind: "dependents", templates: [...dependents] });
  }
  if (unknownDependents.length > 0 && !force) {
    refusals.push({
      kind: "unknown-dependents",
      templates: [...unknownDependents],
    });
  }
  if (unsafe.length > 0 && !keepFiles) {
    refusals.push({ kind: "unsafe-paths", paths: [...unsafe] });
  }
  if (refusals.length > 0) {
    return { kind: "refused", templateId, refusals };
  }

  // Shared paths are matched on a folded key: "A.txt" and "a.txt", or two
  // Unicode spellings of one name, are ONE file on a case-insensitive
  // filesystem. On a case-sensitive one this only keeps more. A path the
  // other template records in an unsafe spelling is not seen here.
  const sharedPaths = new Set<string>();
  for (const id of otherIds) {
    for (const recorded of recordedPaths(config, id).safe) {
      sharedPaths.add(sharedPathKey(recorded.path));
    }
  }

  const deleteFiles: string[] = [];
  const deleteChanged: string[] = [];
  const keptChanged: string[] = [];
  const keptShared: string[] = [];
  const keptOther: string[] = [];
  const keptByFlag: string[] = [];
  const alreadyAbsent: string[] = [];

  for (const { path, contentHashes } of safe) {
    if (sharedPaths.has(sharedPathKey(path))) {
      keptShared.push(path);
      continue;
    }
    const state = fileStates.get(path);
    if (state === undefined || state.kind === "other") {
      keptOther.push(path);
      continue;
    }
    if (state.kind === "absent") {
      alreadyAbsent.push(path);
      continue;
    }
    if (contentHashes.includes(state.contentHash)) {
      if (keepFiles) {
        keptByFlag.push(path);
      } else {
        deleteFiles.push(path);
      }
      continue;
    }
    if (force) {
      if (keepFiles) {
        keptByFlag.push(path);
      } else {
        deleteFiles.push(path);
        deleteChanged.push(path);
      }
    } else {
      keptChanged.push(path);
    }
  }

  return {
    kind: "remove",
    templateId,
    deleteFiles: [...deleteFiles].sort(),
    deleteChanged: [...deleteChanged].sort(),
    keptChanged: [...keptChanged].sort(),
    keptShared: [...keptShared].sort(),
    keptOther: [...keptOther].sort(),
    keptByFlag: [...keptByFlag].sort(),
    alreadyAbsent: [...alreadyAbsent].sort(),
    brokenDependents: force ? [...dependents] : [],
    unknownDependents: force ? [...unknownDependents] : [],
    malformedRecords: malformed,
  };
}
