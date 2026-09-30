import { stat } from "node:fs/promises";

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
