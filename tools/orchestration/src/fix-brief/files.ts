import { access, writeFile } from "node:fs/promises";

/** Whether a path exists. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A writer that creates the file or fails. The `wx` flag is the half of "never
 * overwrite" that a pre-check cannot be: the check and the write are two
 * moments, and anything that creates the file between them is refused by the
 * kernel (EEXIST) rather than truncated by this tool.
 */
export function exclusiveWriter(): (
  path: string,
  text: string,
) => Promise<void> {
  return (path, text) =>
    writeFile(path, text, { encoding: "utf8", flag: "wx" });
}
