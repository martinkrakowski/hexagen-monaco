/**
 * Reads a zip's central directory in the browser, without inflating anything.
 * The reader library collapses duplicate names and hides the mode bits, so the
 * checks that depend on them (duplicates, symlinks, declared sizes, entry
 * count) run here on the raw bytes, before any entry is opened.
 */

export interface ZipDirectoryEntry {
  readonly name: string;
  /** Size declared by the central directory. It can lie; inflation is capped separately. */
  readonly declaredSize: number;
  readonly isSymlink: boolean;
  readonly isDirectory: boolean;
  readonly encrypted: boolean;
}

export class ZipDirectoryError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const MAX_COMMENT = 0xffff;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const HOST_UNIX = 3;

const utf8 = new TextDecoder("utf-8");

/** Throws `ZipDirectoryError` when `maxEntries` is exceeded, before listing them. */
export function readZipDirectory(
  bytes: Uint8Array,
  maxEntries: number,
): ZipDirectoryEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - MAX_COMMENT);
  for (let p = bytes.length - 22; p >= lowest; p--) {
    if (view.getUint32(p, true) === EOCD_SIG) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new ZipDirectoryError("not a readable zip file");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  let p = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || p === 0xffffffff) {
    throw new ZipDirectoryError("zip64 archives are not supported");
  }
  if (count > maxEntries) {
    throw new ZipDirectoryError(
      `the zip has too many entries (${count}; the limit is ${maxEntries})`,
    );
  }
  const out: ZipDirectoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CEN_SIG) {
      throw new ZipDirectoryError("the zip's central directory is damaged");
    }
    const madeBy = view.getUint16(p + 4, true);
    const flags = view.getUint16(p + 8, true);
    const declaredSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const attrs = view.getUint32(p + 38, true);
    if (p + 46 + nameLen > bytes.length) {
      throw new ZipDirectoryError("the zip's central directory is damaged");
    }
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const mode = attrs >>> 16;
    out.push({
      name,
      declaredSize,
      isSymlink: madeBy >>> 8 === HOST_UNIX && (mode & S_IFMT) === S_IFLNK,
      isDirectory: name.endsWith("/"),
      encrypted: (flags & 1) !== 0,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
