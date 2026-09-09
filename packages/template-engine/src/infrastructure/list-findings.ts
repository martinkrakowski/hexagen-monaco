import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../domain/findings/finding.js";
import type { FindingQuery } from "../domain/findings/finding-query.js";
import { findingMatchesQuery } from "../domain/findings/finding-query.js";
import { isSemver } from "../domain/findings/semver.js";
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
 * A read-path fault that is about a specific finding file (a schema refusal
 * or a read fault), the store's own structure (its manifest), or the
 * caller's query — carrying the file the fault is in, or the empty string
 * when the fault is in the caller's arguments and no store file is in it.
 */
export class FindingStoreError extends Error {
  /**
   * The finding file (or template-directory member) the fault is in — the
   * empty string when the fault is in the caller's query arguments.
   */
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
  // A malformed query version is refused up front, as the exported error
  // type: the domain predicate checks it lazily (on the first finding it
  // compares), so on a tree with nothing to compare it would otherwise
  // resolve "successfully" and the caller's `instanceof FindingStoreError`
  // handling would never see the argument fault. No store `file` is in it:
  // the fault is in the caller's arguments, and `file` is "".
  if (query.version !== undefined && !isSemver(query.version)) {
    throw new FindingStoreError(
      "",
      `query version '${query.version}' is not a well-formed semver version — ` +
        `the version filter cannot be applied`,
    );
  }

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
      const text = await readFindingFile(templatesDir, file);
      const result = validateFinding(text, context);
      if (!result.success) {
        throw new FindingStoreError(
          file,
          `${rel(templatesDir, file)} — ${result.error.field}: ${result.error.message}`,
        );
      }
      const shaped = FINDING_FILENAME_RE.exec(path.basename(file));
      if (!shaped) {
        throw new FindingStoreError(
          file,
          `${rel(templatesDir, file)} — filename '${path.basename(file)}' does not match ` +
            `the NNNN-<slug>.md shape (F-D1): four digits, a hyphen, a kebab slug, .md`,
        );
      }
      if (result.value.id !== shaped[1]) {
        throw new FindingStoreError(
          file,
          `${rel(templatesDir, file)} — id '${result.value.id}' does not match ` +
            `the filename sequence number '${shaped[1]}' — the id is the ` +
            `zero-padded sequence number its filename opened with (F-D1)`,
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
 * The finding file's text. Every read fault surfaces TYPED, naming the file
 * — a permission fault or a dangling symlinked finding carries the file it
 * is in, exactly like a schema refusal does, so a consumer matching on
 * FindingStoreError can print "corrupt finding: <file>" for any read-path
 * fault instead of catching an unhandled raw Error.
 */
async function readFindingFile(
  templatesDir: string,
  file: string,
): Promise<string> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (err) {
    throw new FindingStoreError(
      file,
      `${rel(templatesDir, file)} — the finding file cannot be read — ` +
        `${(err as NodeJS.ErrnoException).message}`,
    );
  }
}

/**
 * The validation context for one template subject: the subject the file sits
 * under is the directory, the kind is template by construction (the reader
 * only walks `<templatesDir>/<id>/findings/`), and the current version comes
 * from that template's manifest.json — read only once a template actually has
 * finding files, so a tree of finding-less templates costs nothing.
 *
 * The manifest read is wrapped, not bare: a corrupt manifest.json is a
 * FindingStoreError about that manifest, with its path — not a raw
 * SyntaxError naming no file at all.
 */
async function templateContext(
  templatesDir: string,
  subjectId: string,
): Promise<FindingContext> {
  const manifestFile = path.join(templatesDir, subjectId, "manifest.json");
  let manifest;
  try {
    manifest = validateManifest(
      JSON.parse(await fs.readFile(manifestFile, "utf-8")),
    );
  } catch (err) {
    throw new FindingStoreError(
      manifestFile,
      `${rel(templatesDir, manifestFile)} — the subject's manifest.json ` +
        `cannot be read as a valid manifest — ` +
        `${(err as Error).message}`,
    );
  }
  // F-D6's join key is the subject id: the store's whole version filter
  // rests on joining a finding's fixedIn/subjectVersion against the
  // subject's CURRENT version — and that version must come from the
  // manifest that belongs to THIS directory. A directory whose
  // manifest.json declares another id is a misplaced or half-updated tree;
  // trusting its version here would hang beta's version off alpha's
  // findings, and the not-ahead check would then run against a version
  // that has nothing to do with the subject. Refuse it, naming the
  // directory and both ids.
  if (manifest.id !== subjectId) {
    throw new FindingStoreError(
      path.join(templatesDir, subjectId, "manifest.json"),
      `template directory '${subjectId}' holds a manifest declaring id ` +
        `'${manifest.id}' — the subject id a finding's version joins ` +
        `against is the directory name, so a manifest must name the ` +
        `directory it lives in (F-D6)`,
    );
  }
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

/**
 * F-D1's filename shape, as in the guard: four digits, a hyphen, a kebab
 * slug, then `.md` — extension matched case-insensitively, matching the
 * suffix rule above. The guard enforces the canonical lower-case spelling
 * on the committed store it governs; this reader's subjects are an
 * installed tree it does NOT control, where nothing has run the guard, so
 * it accepts the same filename in any case rather than lose a finding it
 * can fully validate. Captured so the id agreement compares the
 * front-matter `id` against the sequence number the filename actually
 * carries.
 */
const FINDING_FILENAME_RE = /^([0-9]{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/i;
