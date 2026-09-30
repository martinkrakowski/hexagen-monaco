import { lstat, stat } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * File probes for the bins' filesystem adapters.
 *
 * `access()` is true for a directory, so a directory sitting where `ci.yml` (or
 * a scaffold file) belongs passed as "present". These probes distinguish a
 * regular file, nothing at all, and something else in the way.
 */

/** True only for a regular file. A missing path and a directory are both false. */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** True when something that is NOT a regular file occupies the path. */
export async function isOccupiedByNonFile(path: string): Promise<boolean> {
  try {
    return !(await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The first ANCESTOR of `relPath` (root-relative, parent directories only) that
 * exists and is not a directory, as a root-relative path; `undefined` when every
 * existing ancestor is a directory.
 *
 * `stat` of `.lane/.gitignore` when `.lane` is a regular file fails with ENOTDIR,
 * which reads as "absent" to `isFile` and `isOccupiedByNonFile`, and the write's
 * `mkdir` then throws. A dangling symlink is blocking too: it is not a
 * directory, yet `stat` cannot see it, so `lstat` is the second opinion.
 */
export async function nonDirectoryAncestor(
  root: string,
  relPath: string,
): Promise<string | undefined> {
  const ancestors: string[] = [];
  for (let at = dirname(relPath); at !== "." && at !== "/"; at = dirname(at)) {
    ancestors.unshift(at);
  }
  for (const ancestor of ancestors) {
    const full = `${root}/${ancestor}`;
    try {
      if (!(await stat(full)).isDirectory()) return ancestor;
    } catch {
      try {
        await lstat(full);
        return ancestor; // a dangling symlink
      } catch {
        return undefined; // nothing here, so nothing deeper either
      }
    }
  }
  return undefined;
}
