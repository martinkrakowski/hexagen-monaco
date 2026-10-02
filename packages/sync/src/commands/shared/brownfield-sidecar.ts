import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Contract, ObservedReport, Slice } from "@hexagen/shared";
import { ObserveError } from "../observe/index.js";
import { samePath } from "../observe/same-path.js";
import { GitExcludeError, excludeWouldChange } from "./git-exclude.js";
import { SidecarFileExistsError } from "./sidecar-write.js";

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

/** A sidecar file that does not exist (a missing slice, observed report or contract). */
export class NotFoundError extends UsageError {}

/** Turn a thrown precondition failure into an exit-2 result. */
export function asResult(e: unknown, messages: string[]): CommandResult {
  if (
    e instanceof UsageError ||
    e instanceof ObserveError ||
    e instanceof GitExcludeError ||
    e instanceof SidecarFileExistsError
  ) {
    messages.push(e.message);
    return { exitCode: 2, messages };
  }
  throw e;
}

export const SIDECAR_ENTRY = ".hexagen/";

// The edge-rule helpers live in @hexagen/shared so the web viewer shares them.
export {
  prefixHasTarget,
  sliceEntryOf,
  targetInSlice,
  underPrefix,
} from "@hexagen/shared";

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
      throw new NotFoundError(`${label} does not exist: ${file}`);
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

/** Every command works from the repo top level, never a subdirectory. */
export function assertTopLevel(root: string): void {
  const top = git(root, ["rev-parse", "--show-toplevel"])?.trim();
  if (!top) throw new UsageError(`${root} is not inside a git checkout`);
  let same = false;
  try {
    same = samePath(
      realpathSync.native(path.resolve(top)),
      realpathSync.native(path.resolve(root)),
    );
  } catch {
    same = false;
  }
  if (!same) {
    throw new UsageError(`--root must be the repo top level (git says ${top})`);
  }
}

export async function loadSlice(root: string): Promise<Slice> {
  assertTopLevel(root);
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

const EXPIRES_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Inclusive end-of-day UTC: an entry that expires on date D is still valid
 * throughout that UTC day and expires at D+1 00:00:00.000Z. Moved here so the contract loader can validate dates; a copy of
 * `isSuppressionExpired` in `tools/arch-linter/src/ratchet-baseline.ts`
 * (this package does not depend on the linter); a test pins the same cases.
 */
export function isSuppressionExpired(
  expires: string,
  now: Date = new Date(),
): boolean {
  const match = EXPIRES_RE.exec(expires);
  if (!match) {
    throw new Error(
      `'expires' must be YYYY-MM-DD (got ${JSON.stringify(expires)})`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`'expires' is not a real calendar date (${expires})`);
  }
  return now.getTime() > Date.UTC(year, month - 1, day, 23, 59, 59, 999);
}

/** The contract, or undefined when none exists yet. */
export async function loadContract(
  root: string,
): Promise<Contract | undefined> {
  assertTopLevel(root);
  const file = contractPath(root);
  let value: unknown;
  try {
    value = await readJson(file, "contract");
  } catch (e) {
    if (e instanceof NotFoundError) return undefined;
    throw e;
  }
  const contract = parseWith(Contract, value, file);
  // A date that is not a real calendar day would crash the expiry check later.
  for (const k of contract.knownViolations) {
    if (k.expires === undefined) continue;
    try {
      isSuppressionExpired(k.expires);
    } catch (err) {
      throw new UsageError(
        `${file}: knownViolations entry ${k.rule} ${k.file} ${k.specifier}: ${(err as Error).message}`,
      );
    }
  }
  return contract;
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
      `observed.json (commit ${observed.repo.commit}) is not newer than the slice's commit ${slice.repo.commit}, or one of them is not in this repository; re-run \`hexagen observe\``,
    );
  }
  const head = headCommit(root);
  if (head === null) {
    if (strict) problems.push("HEAD cannot be resolved (--strict)");
  } else if (head !== observed.repo.commit) {
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

/**
 * Run `fn` holding `.hexagen/contract.json.lock`, created with O_EXCL and
 * holding this pid. A lock that is already there exits 2; it is never broken
 * automatically. The lock is removed in a `finally`. When `.hexagen` does not
 * exist yet nothing can be locked and `fn` runs (it fails on the missing slice).
 */
export async function withContractLock<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = `${contractPath(root)}.lock`;
  let handle;
  try {
    handle = await open(lock, "wx");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new UsageError(
        "another contract command is running (remove .hexagen/contract.json.lock if no command is)",
      );
    }
    if (code === "ENOENT") return fn();
    throw e;
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
    handle = undefined;
    return await fn();
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(lock).catch(() => undefined);
  }
}
