import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  MAX_SCAN_ENTRY_UNCOMPRESSED_BYTES,
  MAX_SCAN_UNCOMPRESSED_BYTES,
  MAX_SCAN_ZIP_ENTRIES,
} from "./limits";

/**
 * Zip-slip: an archive entry whose resolved path would escape `destRoot`.
 * The HTTP mapper turns this into 400 — never unpack, never spawn.
 */
export class ZipSlipError extends Error {
  readonly entryName: string;

  constructor(entryName: string) {
    super("Zip contains an unsafe path and was rejected");
    this.name = "ZipSlipError";
    this.entryName = entryName;
  }
}

export class EmptyZipError extends Error {
  constructor() {
    super("The zip is empty — nothing to scan.");
    this.name = "EmptyZipError";
  }
}

export class InvalidZipError extends Error {
  constructor(cause?: unknown) {
    super("Could not read the uploaded file as a zip archive.");
    this.name = "InvalidZipError";
    if (cause instanceof Error) this.cause = cause;
  }
}

export type ZipUnpackLimitKind =
  | "entries"
  | "entry-bytes"
  | "uncompressed-bytes";

/** Archive exceeded an extraction budget (entry count / per-file / aggregate). */
export class ZipResourceLimitError extends Error {
  readonly limit: ZipUnpackLimitKind;

  constructor(limit: ZipUnpackLimitKind, message: string) {
    super(message);
    this.name = "ZipResourceLimitError";
    this.limit = limit;
  }
}

export interface ZipUnpackLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxUncompressedBytes: number;
}

export const DEFAULT_ZIP_UNPACK_LIMITS: ZipUnpackLimits = {
  maxEntries: MAX_SCAN_ZIP_ENTRIES,
  maxEntryBytes: MAX_SCAN_ENTRY_UNCOMPRESSED_BYTES,
  maxUncompressedBytes: MAX_SCAN_UNCOMPRESSED_BYTES,
};

const WINDOWS_ABS = /^[a-zA-Z]:[\\/]/;
const UNC = /^[\\/]{2}/;

/**
 * True when `entryName` would write outside `destRoot` (zip-slip).
 *
 * Rejects: `..` segments, absolute POSIX/Windows/UNC paths, NUL bytes, and
 * any resolve() that escapes the destination even after normalization.
 */
export function isUnsafeZipEntry(destRoot: string, entryName: string): boolean {
  if (entryName.length === 0 || entryName.includes("\0")) return true;
  if (
    path.isAbsolute(entryName) ||
    WINDOWS_ABS.test(entryName) ||
    UNC.test(entryName)
  ) {
    return true;
  }
  const posix = entryName.replace(/\\/g, "/");
  if (
    posix.startsWith("/") ||
    posix.split("/").some((segment) => segment === "..")
  ) {
    return true;
  }
  const resolvedRoot = path.resolve(destRoot);
  const resolvedDest = path.resolve(destRoot, posix);
  const prefix = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;
  return resolvedDest !== resolvedRoot && !resolvedDest.startsWith(prefix);
}

export function assertSafeZipEntry(destRoot: string, entryName: string): void {
  if (isUnsafeZipEntry(destRoot, entryName)) {
    throw new ZipSlipError(entryName);
  }
}

function shouldSkipEntry(name: string): boolean {
  const posix = name.replace(/\\/g, "/");
  return (
    posix.startsWith("__MACOSX/") ||
    posix.endsWith("/.DS_Store") ||
    posix === ".DS_Store"
  );
}

/**
 * Unpack `buffer` into `destRoot`. Validates every entry BEFORE writing so a
 * zip-slip name never leaves a partial tree on disk. Caps entry count and
 * observed uncompressed bytes so a small compressed archive cannot expand
 * without bound.
 */
export async function unpackZipToDir(
  buffer: Buffer,
  destRoot: string,
  limits: ZipUnpackLimits = DEFAULT_ZIP_UNPACK_LIMITS,
): Promise<{ filesWritten: number }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (cause) {
    throw new InvalidZipError(cause);
  }

  const entries = Object.values(zip.files).filter(
    (entry) => !shouldSkipEntry(entry.name),
  );
  if (entries.length > limits.maxEntries) {
    throw new ZipResourceLimitError(
      "entries",
      `Zip has too many entries (exceeds ${limits.maxEntries}) and was rejected`,
    );
  }
  for (const entry of entries) {
    assertSafeZipEntry(destRoot, entry.name);
  }

  let filesWritten = 0;
  let uncompressedBytes = 0;
  for (const entry of entries) {
    const dest = path.join(destRoot, entry.name.replace(/\\/g, "/"));
    if (entry.dir) {
      await mkdir(dest, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    const data = await entry.async("nodebuffer");
    if (data.byteLength > limits.maxEntryBytes) {
      throw new ZipResourceLimitError(
        "entry-bytes",
        `A zip entry exceeds ${limits.maxEntryBytes.toLocaleString()} uncompressed bytes and was rejected`,
      );
    }
    uncompressedBytes += data.byteLength;
    if (uncompressedBytes > limits.maxUncompressedBytes) {
      throw new ZipResourceLimitError(
        "uncompressed-bytes",
        `Uncompressed zip contents exceed ${limits.maxUncompressedBytes.toLocaleString()} bytes and were rejected`,
      );
    }
    await writeFile(dest, data);
    filesWritten += 1;
  }

  if (filesWritten === 0) {
    throw new EmptyZipError();
  }
  return { filesWritten };
}
