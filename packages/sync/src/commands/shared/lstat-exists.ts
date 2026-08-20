import { promises as fs } from "node:fs";
import { err, ok, type Result } from "../../domain/result.js";

/**
 * Existence via lstat: a dangling or live symlink is present.
 * Only ENOENT is absence; EACCES and other errors propagate.
 */
export async function lstatExists(
  target: string,
): Promise<Result<boolean, Error>> {
  try {
    await fs.lstat(target);
    return ok(true);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return ok(false);
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
