import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../domain/findings/finding.js";
import type { FindingQuery } from "../domain/findings/finding-query.js";
import { findingMatchesQuery } from "../domain/findings/finding-query.js";
import {
  validateFinding,
  type FindingContext,
} from "../domain/findings/validate-finding.js";
import { validateManifest } from "../domain/template-manifest.js";

/**
 * The findings reader — the infrastructure half of the read path (plan §3 G4).
 * `listFindings` walks `<templatesDir>/<id>/findings/**`, hands every `.md`
 * file to the domain's `validateFinding`, and filters the validated records
 * with the domain's query predicates. The templates directory is an ARGUMENT,
 * never resolved here: the caller owns resolution (`sync`'s install resolves
 * its own copied tree; this repo's guard resolves the monorepo tree), which is
 * what lets one function serve both layouts.
 *
 * Every finding this function returns is schema-valid: a finding file that
 * fails validation FAILS THE CALL, naming the file. Silently skipping it
 * would turn a corrupt or half-written store into quietly narrower results —
 * for a tool whose purpose is surfacing known defects, a hole in "what is
 * known about my templates" is itself a defect, so the fault surfaces with
 * the file named instead.
 */

/**
 * A read-path fault that is about a specific finding file (a schema refusal)
 * or the store's own structure, carrying the file the fault is in.
 */
export class FindingStoreError extends Error {
  /** The finding file (or template directory member) the fault is in. */
  readonly file: string;

  constructor(file: string, message: string) {
    super(message);
    this.name = "FindingStoreError";
    this.file = file;
  }
}

/**
 * List the findings under `<templatesDir>/<id>/findings/**` that match
 * `query` (absent options mean no filter). An absent or empty templates
 * directory yields an empty list — a store with no findings is normal, not an
 * error — but any other I/O fault (permissions, a dangling symlinked finding)
 * surfaces rather than reading as "no findings".
 *
 * Template directories top-level are real directories only; files and
 * symlinked directories are not template subjects. Under `findings/`, the
 * guard's collection rules hold: real directories are recursed and `.md`
 * files are read straight through, including symlinked files (readFile
 * dereferences — a bad finding behind a link cannot hide), while symlinked
 * directories are not followed (a link can point anywhere and a cycle would
 * hang the read).
 *
 * `generatorRoot` is handed to `validateFinding` as the empty string — the
 * context's documented strictest reading, so every absolute path in a body is
 * refused. A shipped finding's body has no honest use for an absolute path:
 * inside-the-checkout paths are meaningless to an installed tree, and the
 * looser authoring gate can only be an accident waiting to leak a checkout
 * path into a consumer's read.
 */
export async function listFindings(
  templatesDir: string,
  query: FindingQuery = {},
): Promise<Finding[]> {
  let templates: Dirent[];
  try {
    templates = await fs.readdir(templatesDir, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err; // any other IO fault must surface, not read as "no findings"
  }

  const findings: Finding[] = [];
  for (const entry of sortByName(templates)) {
    if (!entry.isDirectory()) continue;
    const subjectId = entry.name;
    const files = await collectFindingFiles(templatesDir, subjectId);
    if (files === undefined || files.length === 0) continue;
    const context = await templateContext(templatesDir, subjectId);
    for (const file of files) {
      const text = await fs.readFile(file, "utf-8");
      const result = validateFinding(text, context);
      if (!result.success) {
        throw new FindingStoreError(
          file,
          `${rel(templatesDir, file)} — ${result.error.field}: ${result.error.message}`,
        );
      }
      if (!findingMatchesQuery(result.value, query)) continue;
      findings.push(result.value);
    }
  }
  return findings;
}

/**
 * The finding files one template subject contributes — or undefined when it
 * contributes nothing: no `findings/` entry, a non-directory `findings`
 * entry (a stray file is not a findings store), or a symlinked `findings`
 * directory whose resolved target leaves `templatesDir`.
 *
 * Every read under `findings/` dereferences that directory, so its type and
 * containment are pinned to the RESOLVED path before any walk: a plain
 * `findings` file reads as "no findings" (a template contributes only
 * through a real findings walk — readdir on a file is a raw ENOTDIR, which
 * is a filesystem accident, not a store rule), and a symlinked `findings/`
 * is walked only when its target resolves inside `templatesDir` (the plan's
 * "reads only beneath it" — the property that makes `listFindings` safe to
 * point at an installed package). A symlink pointing outside is not
 * followed, the same rule the walk applies to the symlinked directories
 * inside findings/; the caller handed this reader templatesDir and nothing
 * beyond it is read.
 */
async function collectFindingFiles(
  templatesDir: string,
  subjectId: string,
): Promise<string[] | undefined> {
  const findingsDir = path.join(templatesDir, subjectId, "findings");
  let findingsResolved: Stats;
  try {
    findingsResolved = await fs.stat(findingsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT: absent findings directory — the normal, empty state.
    // ENOTDIR: a broken path segment — "no findings", not a store fault.
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw err;
  }
  if (!findingsResolved.isDirectory()) return undefined;
  const [resolvedRoot, resolvedFindings] = await Promise.all([
    fs.realpath(templatesDir),
    fs.realpath(findingsDir),
  ]);
  if (
    resolvedFindings !== resolvedRoot &&
    !resolvedFindings.startsWith(resolvedRoot + path.sep)
  ) {
    return undefined;
  }
  return walkFindingsDir(findingsDir);
}

/**
 * The recursive half: descends real directories, classifies every entry by
 * its RESOLVED type rather than its Dirent flags alone (a symlink named
 * `0009-dirlink.md` whose target is a directory is a not-followed directory,
 * not a finding file readFile must die on), reads any `.md` entry that
 * resolves to a file, and pushes an unresolving `.md`-named entry through to
 * readFile so the dangling link surfaces from the read as the typed fault
 * that names the file, never as a silent skip.
 */
async function walkFindingsDir(findingsDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(findingsDir, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch (err) {
    // Most templates have no findings/ dir yet — absent is the normal state
    // and must read as "no findings", not as a fault (the guard's rule).
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files: string[] = [];
  for (const entry of sortByName(entries)) {
    const full = path.join(findingsDir, entry.name);
    let resolved: Stats | null;
    try {
      resolved = await fs.stat(full);
    } catch (err) {
      // ENOENT = a dangling entry: pin it to the read path below so a
      // `.md`-named dangling link is surfaced by readFile, not skipped.
      // Any other stat fault is an IO fault and must surface whole.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") resolved = null;
      else throw err;
    }
    if (resolved?.isDirectory()) {
      if (entry.isSymbolicLink()) continue; // a link can point anywhere; a cycle would hang the read
      files.push(...(await walkFindingsDir(full)));
      continue;
    }
    if (!FINDING_SUFFIX_RE.test(entry.name)) continue;
    if (resolved === null || resolved.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * The validation context for one template subject: the subject the file sits
 * under is the directory, the kind is template by construction (the reader
 * only walks `<templatesDir>/<id>/findings/`), and the current version comes
 * from that template's manifest.json — read only once a template actually has
 * finding files, so a tree of finding-less templates costs nothing.
 */
async function templateContext(
  templatesDir: string,
  subjectId: string,
): Promise<FindingContext> {
  const manifest = validateManifest(
    JSON.parse(
      await fs.readFile(
        path.join(templatesDir, subjectId, "manifest.json"),
        "utf-8",
      ),
    ),
  );
  const versions = new Map([[subjectId, manifest.version]]);
  return {
    subjectId,
    subjectKind: "template",
    locationLabel: `templates/${subjectId}/findings/`,
    currentVersion: (kind, id) =>
      kind === "template" ? versions.get(id) : undefined,
    generatorRoot: "",
  };
}

/** Names in sorted order so the returned list is deterministic. */
function sortByName(entries: Dirent[]): Dirent[] {
  return [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/** Root-relative, POSIX-separated, for error messages. */
function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * A `.md` suffix in any letter case. On case-insensitive filesystems
 * (macOS, Windows) an upper-case `.MD` is the same file a finder (Spotlight,
 * Explorer, `ls`) shows, so dropping it would leave a silent hole in "what
 * is known about my templates" — precisely what this reader may never do
 * quietly. A suffix that matches may still be refused by the shape check at
 * read time, but it SURFACES, naming the file; it is never dropped as if
 * absent.
 */
const FINDING_SUFFIX_RE = /\.md$/i;
