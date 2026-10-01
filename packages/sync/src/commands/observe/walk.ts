import { promises as fs } from "node:fs";
import path from "node:path";
import { isIgnored, parseIgnoreFile, type ScopedRules } from "./ignore.js";

/** Never descended into. `.hexagen` is observe's own output directory. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "vendor",
  ".git",
  ".hg",
  ".svn",
  ".hexagen",
]);

export interface WalkLimits {
  readonly maxFiles: number;
  readonly maxMs: number;
  readonly now: () => number;
}

export interface WalkResult {
  /** Repo-relative POSIX paths of non-ignored regular files, sorted. */
  readonly files: string[];
  /** Repo-relative POSIX paths of walked directories (not the root), sorted. */
  readonly dirs: string[];
  /** Gitignored directories named `dist` or `build`, with a trailing `/`. */
  readonly ignoredBuildDirs: string[];
  /** The reason the walk stopped early, or null when it finished. */
  readonly truncated: string | null;
}

export function timeCapReason(maxMs: number): string {
  return `time cap reached (maxMs=${maxMs})`;
}

/**
 * Walk `root` without following symlinks. Skips VCS, vendored and dependency
 * directories, and honours the root `.gitignore` and any nested `.gitignore`.
 * Ignored directories are not descended into.
 */
export async function walk(
  root: string,
  limits: WalkLimits,
): Promise<WalkResult> {
  const start = limits.now();
  const files: string[] = [];
  const dirs: string[] = [];
  const ignoredBuildDirs: string[] = [];
  let truncated: string | null = null;
  let tick = 0;

  const overTime = (): boolean => limits.now() - start > limits.maxMs;

  async function visit(
    rel: string,
    scopes: readonly ScopedRules[],
  ): Promise<void> {
    if (truncated) return;
    if (overTime()) {
      truncated = timeCapReason(limits.maxMs);
      return;
    }
    const abs = rel === "" ? root : path.join(root, rel);
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skipped, not fatal
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    let local = scopes;
    if (entries.some((e) => e.name === ".gitignore" && e.isFile())) {
      try {
        const text = await fs.readFile(path.join(abs, ".gitignore"), "utf8");
        local = [...scopes, { base: rel, rules: parseIgnoreFile(text) }];
      } catch {
        // unreadable .gitignore: treated as absent
      }
    }

    const subdirs: string[] = [];
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (isIgnored(local, childRel, true)) {
          if (entry.name === "dist" || entry.name === "build") {
            ignoredBuildDirs.push(`${childRel}/`);
          }
          continue;
        }
        subdirs.push(childRel);
      } else if (entry.isFile()) {
        if (isIgnored(local, childRel, false)) continue;
        if (files.length >= limits.maxFiles) {
          truncated = `file cap reached (maxFiles=${limits.maxFiles})`;
          return;
        }
        files.push(childRel);
        if (++tick % 256 === 0 && overTime()) {
          truncated = timeCapReason(limits.maxMs);
          return;
        }
      }
    }
    for (const sub of subdirs) {
      dirs.push(sub);
      await visit(sub, local);
      if (truncated) return;
    }
  }

  await visit("", []);
  files.sort();
  dirs.sort();
  ignoredBuildDirs.sort();
  return { files, dirs, ignoredBuildDirs, truncated };
}
