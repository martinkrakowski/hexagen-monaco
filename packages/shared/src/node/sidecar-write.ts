import { randomBytes } from "node:crypto";
import { link, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

export class SidecarFileExistsError extends Error {}

async function writeTemp(
  target: string,
  text: string,
  guard?: () => Promise<void>,
): Promise<string> {
  await mkdir(path.dirname(target), { recursive: true });
  await guard?.();
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(tmp, "wx");
  try {
    await handle.writeFile(text, "utf-8");
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return tmp;
}

/**
 * Temp file, then a hard link to the final name: `link` fails with EEXIST
 * instead of replacing, so an existing file is never overwritten, and a
 * reader never sees a half-written file.
 */
export async function writeFileExclusive(
  target: string,
  text: string,
  /**
   * Called before the temp file is created and again just before the link; a
   * throw aborts the write (the temp file is removed). For a caller that must
   * re-check where the directory really points.
   */
  guard?: () => Promise<void>,
): Promise<void> {
  const tmp = await writeTemp(target, text, guard);
  try {
    await guard?.();
    await link(tmp, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SidecarFileExistsError(`${target} already exists`);
    }
    throw error;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/** Temp file, then an atomic rename over `target`: for files that are updated in place. */
export async function writeFileReplace(
  target: string,
  text: string,
): Promise<void> {
  const tmp = await writeTemp(target, text);
  try {
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}
