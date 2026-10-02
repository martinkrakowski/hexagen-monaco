import { constants, promises as fs } from "node:fs";

export type SafeRead =
  | { ok: true; text: string; size: number }
  | { ok: false; why: "unreadable" | "too-large" };

/**
 * Read a regular file without following a symlink in its last component, so a
 * file swapped for a link after the walk is refused rather than read.
 *
 * Where `O_NOFOLLOW` exists the file is opened with it; elsewhere (Windows) the
 * path is `lstat`ed first and a symlink refused. The size limit is decided on
 * the opened handle (`fstat`), and the bytes are read through that handle, so
 * the size checked is the size read. Parent directories are not re-checked: the
 * walk never follows a symlinked directory, and a swap of one is outside this
 * tool's threat model.
 */
export async function safeReadText(
  abs: string,
  maxBytes: number,
): Promise<SafeRead> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const noFollow: number | undefined = constants.O_NOFOLLOW;
    if (noFollow !== undefined) {
      handle = await fs.open(abs, constants.O_RDONLY | noFollow);
    } else {
      if ((await fs.lstat(abs)).isSymbolicLink()) {
        return { ok: false, why: "unreadable" };
      }
      handle = await fs.open(abs, "r");
    }
    const st = await handle.stat();
    if (!st.isFile()) return { ok: false, why: "unreadable" };
    if (st.size > maxBytes) return { ok: false, why: "too-large" };
    const buf = Buffer.alloc(st.size);
    let filled = 0;
    while (filled < st.size) {
      const { bytesRead } = await handle.read(
        buf,
        filled,
        st.size - filled,
        filled,
      );
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return {
      ok: true,
      text: buf.subarray(0, filled).toString("utf8"),
      size: st.size,
    };
  } catch {
    return { ok: false, why: "unreadable" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export type SafeReadBytes =
  | { ok: true; bytes: Buffer }
  | { ok: false; why: "unreadable" | "too-large" };

/** `safeReadText`'s twin that returns the exact bytes (for files that are hashed or signed). */
export async function safeReadBytes(
  abs: string,
  maxBytes: number,
): Promise<SafeReadBytes> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const noFollow: number | undefined = constants.O_NOFOLLOW;
    if (noFollow !== undefined) {
      handle = await fs.open(abs, constants.O_RDONLY | noFollow);
    } else {
      if ((await fs.lstat(abs)).isSymbolicLink()) {
        return { ok: false, why: "unreadable" };
      }
      handle = await fs.open(abs, "r");
    }
    const st = await handle.stat();
    if (!st.isFile()) return { ok: false, why: "unreadable" };
    if (st.size > maxBytes) return { ok: false, why: "too-large" };
    const buf = Buffer.alloc(st.size);
    let filled = 0;
    while (filled < st.size) {
      const { bytesRead } = await handle.read(
        buf,
        filled,
        st.size - filled,
        filled,
      );
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return { ok: true, bytes: buf.subarray(0, filled) };
  } catch {
    return { ok: false, why: "unreadable" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
