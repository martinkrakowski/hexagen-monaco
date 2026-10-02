import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseIgnoreFile, verdict } from "./ignore.js";

/**
 * Keep a sidecar directory out of `git status` without touching the client's
 * tracked `.gitignore` (plan BW-D1). The exclude file is whatever
 * `git rev-parse --git-path info/exclude` prints, which is correct in linked
 * worktrees (the common dir's file), submodules and `--separate-git-dir`
 * clones, where `.git` is a file rather than a directory.
 *
 * `git add -f` can still stage an excluded path; callers say so.
 */

export class GitExcludeError extends Error {}

function gitOut(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim();
  } catch {
    throw new GitExcludeError(`git ${args.join(" ")} failed in ${cwd}`);
  }
}

/** `p` with its nearest existing ancestor resolved through symlinks. */
export async function realpathOfExistingAncestor(p: string): Promise<string> {
  let current = p;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, path.relative(current, p));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return p;
      current = parent;
    }
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Absolute path of the repo's `info/exclude`. Refuses a path that resolves
 * (through symlinks) outside the repo's git dir, common dir or work tree.
 */
export async function resolveExcludeFile(root: string): Promise<string> {
  const printed = gitOut(root, ["rev-parse", "--git-path", "info/exclude"]);
  const file = path.resolve(root, printed);
  const allowed = [
    gitOut(root, ["rev-parse", "--absolute-git-dir"]),
    path.resolve(root, gitOut(root, ["rev-parse", "--git-common-dir"])),
    gitOut(root, ["rev-parse", "--show-toplevel"]),
  ];
  // A dangling symlink defeats realpath, so follow the link text explicitly.
  let effective = file;
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) {
      effective = path.resolve(path.dirname(file), await fs.readlink(file));
    }
  } catch {
    // absent: the ancestor check below covers where it would be created
  }
  const realFile = await realpathOfExistingAncestor(effective);
  for (const dir of allowed) {
    if (isInside(await fs.realpath(dir), realFile)) return file;
  }
  throw new GitExcludeError(
    `${file} resolves outside the repository's git dir; refusing to edit it`,
  );
}

/**
 * True when the exclude file, read with last-match-wins like git, already
 * ignores `entry` (a directory such as `.hexagen/`). A later negation
 * (`!.hexagen/`) means it is not excluded and the entry must be appended.
 */
function isExcluded(text: string, entry: string): boolean {
  const rules = parseIgnoreFile(text);
  return verdict(rules, entry.replace(/\/$/, ""), true) === true;
}

/**
 * Read-only twin of `ensureExcluded`: true when it would append `entry`.
 * Lets a caller list the write in a preflight before making it.
 */
export async function excludeWouldChange(
  root: string,
  entry: string,
): Promise<{ file: string; changes: boolean }> {
  const file = await resolveExcludeFile(root);
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new GitExcludeError(
        `could not read ${file}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return { file, changes: !isExcluded(text, entry) };
}

/**
 * Append `entry` (e.g. `.hexagen/`) to the repo's exclude file if absent.
 * Idempotent. Returns the file and whether anything was written; any failure
 * throws `GitExcludeError` so the caller can stop before writing its own file.
 */
export async function ensureExcluded(
  root: string,
  entry: string,
): Promise<{ file: string; wrote: boolean }> {
  const file = await resolveExcludeFile(root);
  try {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (isExcluded(text, entry)) return { file, wrote: false };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const prefix = text === "" || text.endsWith("\n") ? "" : "\n";
    await fs.appendFile(file, `${prefix}${entry}\n`, "utf8");
    return { file, wrote: true };
  } catch (e) {
    throw new GitExcludeError(
      `could not update ${file}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
