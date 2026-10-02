import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  Contract,
  ObservedReport,
  Slice,
  isPathInSlice,
  type SlicePaths,
} from "@hexagen/shared";
import { excludeWouldChange } from "./git-exclude.js";

/** Result shape shared by the slice and contract commands. */
export interface CommandResult {
  /** 0 clean/ok, 1 drift or violation, 2 bad input or refused. */
  exitCode: 0 | 1 | 2;
  /** Status lines, printed to stderr. */
  messages: string[];
  /** The command's own output, printed to stdout. */
  stdout?: string;
}

/** A refusal, bad input or failed precondition: exit 2. */
export class UsageError extends Error {}

export const SIDECAR_ENTRY = ".hexagen/";

/** `entry` is a directory prefix (trailing `/`) or an exact file path. */
export function underPrefix(entry: string, candidate: string): boolean {
  return entry.endsWith("/")
    ? candidate.startsWith(entry)
    : candidate === entry;
}

/**
 * True when `to` (an edge target: a file, or a package root written without a
 * trailing `/`, or `.` for the root package) lies inside the slice. A package
 * root is a directory, so it is also tried with a trailing `/`.
 */
export function targetInSlice(slice: SlicePaths, to: string): boolean {
  if (to === ".") return false;
  return isPathInSlice(slice, to) || isPathInSlice(slice, `${to}/`);
}

/** The first slice `paths` entry that contains `p` (a file or package root). */
export function sliceEntryOf(slice: SlicePaths, p: string): string | undefined {
  if (!targetInSlice(slice, p)) return undefined;
  return slice.paths.find((e) => underPrefix(e, p) || underPrefix(e, `${p}/`));
}

/** True when `prefix` (a rule prefix) contains the edge target `to`. */
export function prefixHasTarget(prefix: string, to: string): boolean {
  if (to === ".") return false;
  return underPrefix(prefix, to) || underPrefix(prefix, `${to}/`);
}

export function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
  } catch {
    return null;
  }
}

/** NUL-separated git output as a list. */
function gitZ(root: string, args: string[]): string[] | null {
  const out = git(root, args);
  return out === null ? null : out.split("\0").filter((s) => s.length > 0);
}

/** Tracked and untracked-but-not-ignored files, repo-relative. */
export function listWorkTreeFiles(root: string): string[] {
  const files = gitZ(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (files === null) throw new UsageError(`git ls-files failed in ${root}`);
  return files;
}

const COMMIT_ID = /^[0-9a-f]{4,64}$/i;

/** True when `commit` names a commit object in the repo. */
export function commitExists(root: string, commit: string): boolean {
  if (!COMMIT_ID.test(commit)) return false;
  return git(root, ["cat-file", "-e", `${commit}^{commit}`]) !== null;
}

/** True when `ancestor` is `descendant` or one of its ancestors. */
export function isAncestor(
  root: string,
  ancestor: string,
  descendant: string,
): boolean {
  if (!COMMIT_ID.test(ancestor) || !COMMIT_ID.test(descendant)) return false;
  return (
    git(root, ["merge-base", "--is-ancestor", ancestor, descendant]) !== null
  );
}

export function headCommit(root: string): string | null {
  const out = git(root, ["rev-parse", "HEAD"]);
  return out === null ? null : out.trim();
}

/** Files changed between `commit` and HEAD, restricted to the pathspecs. */
export function changedSince(
  root: string,
  commit: string,
  pathspecs: readonly string[],
): string[] | null {
  if (pathspecs.length === 0) return [];
  return gitZ(root, [
    "diff",
    "--name-only",
    "-z",
    `${commit}..HEAD`,
    "--",
    ...pathspecs.map((p) => `:(literal)${p}`),
  ]);
}

async function readJson(file: string, label: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new UsageError(`${label} does not exist: ${file}`);
    }
    throw new UsageError(
      `could not read ${file}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new UsageError(`${file} is not valid JSON`);
  }
}

export const slicePath = (root: string): string =>
  path.join(root, ".hexagen", "slice.json");
export const observedPath = (root: string): string =>
  path.join(root, ".hexagen", "observed.json");
export const contractPath = (root: string): string =>
  path.join(root, ".hexagen", "contract.json");

function parseWith<T>(
  schema: { parse(v: unknown): T },
  value: unknown,
  file: string,
): T {
  try {
    return schema.parse(value);
  } catch (e) {
    throw new UsageError(
      `${file} does not match its schema: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function loadSlice(root: string): Promise<Slice> {
  const file = slicePath(root);
  return parseWith(Slice, await readJson(file, "slice"), file);
}

export async function loadObserved(root: string): Promise<ObservedReport> {
  const file = observedPath(root);
  return parseWith(
    ObservedReport,
    await readJson(file, "observed report"),
    file,
  );
}

/** The contract, or undefined when none exists yet. */
export async function loadContract(
  root: string,
): Promise<Contract | undefined> {
  const file = contractPath(root);
  let value: unknown;
  try {
    value = await readJson(file, "contract");
  } catch (e) {
    if (e instanceof UsageError && e.message.startsWith("contract does not")) {
      return undefined;
    }
    throw e;
  }
  return parseWith(Contract, value, file);
}

/**
 * Stale-input checks on `observed.json` against the slice (plan BW5 task 3).
 * Returns hard problems (exit 2) and warnings. `observed.repo.commit` must be
 * the slice's `repo.commit` or a descendant of it (the report is "newer" than
 * the slice's commit); a different HEAD is a warning, and a problem with
 * `strict`.
 */
export function staleInputs(
  root: string,
  slice: Slice,
  observed: ObservedReport,
  strict: boolean,
): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!commitExists(root, slice.repo.commit)) {
    problems.push(
      `slice commit ${slice.repo.commit} is not in this repository; cannot tell whether observed.json is newer`,
    );
  } else if (!isAncestor(root, slice.repo.commit, observed.repo.commit)) {
    problems.push(
      `observed.json (commit ${observed.repo.commit}) is not newer than the slice's commit ${slice.repo.commit}; re-run \`hexagen observe\``,
    );
  }
  const head = headCommit(root);
  if (head !== null && head !== observed.repo.commit) {
    const msg = `observed.json was read at ${observed.repo.commit} but HEAD is ${head}; re-run \`hexagen observe\``;
    if (strict) problems.push(`${msg} (--strict)`);
    else warnings.push(`warning: ${msg}`);
  }
  return { problems, warnings };
}

/**
 * Preflight for writes into the sidecar: names every file that will be
 * written, adds the exclude file when it would change, and requires `--yes`.
 * Throws `UsageError` (exit 2) without `--yes`. Returns whether the exclude
 * must be applied.
 */
export async function preflight(
  root: string,
  writes: readonly string[],
  yes: boolean | undefined,
  messages: string[],
): Promise<{ applyExclude: boolean }> {
  const exclude = await excludeWouldChange(root, SIDECAR_ENTRY);
  const all = writes.map((w) => `will write: ${w}`);
  if (exclude.changes) {
    all.push(`will write: ${exclude.file} (adds ${SIDECAR_ENTRY})`);
  }
  messages.push(...all);
  messages.push(
    "note: .hexagen/ is excluded through the exclude file, not .gitignore; `git add -f` can still stage it.",
  );
  if (!yes) {
    throw new UsageError("nothing written; re-run with --yes to proceed.");
  }
  return { applyExclude: exclude.changes };
}
