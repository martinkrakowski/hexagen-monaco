import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A writer that creates the file's directory if it is missing, then creates the
 * file or fails. The `wx` flag is the half of "never overwrite" that a
 * pre-check cannot be: the check and the write are two moments, and anything
 * that creates the file between them is refused by the kernel (EEXIST) rather
 * than truncated by this tool.
 */
export function exclusiveWriterMakingDirectory(): (
  path: string,
  text: string,
) => Promise<void> {
  return async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { encoding: "utf8", flag: "wx" });
  };
}
