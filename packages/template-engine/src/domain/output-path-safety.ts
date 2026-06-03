import path from "node:path";

/**
 * Whether `rel` is a safe relative output path — it stays within its base
 * directory when joined: not absolute, and no `..` traversal that escapes.
 *
 * Template manifests only validate that an output `path` is a non-empty string
 * (no `..`/absolute rejection), so every consumer that joins or writes an output
 * path must reject escaping ones — both the file loader (which would otherwise
 * read arbitrary files) and the in-memory emitter (whose Map key is later
 * written to disk / ZIP / GitHub). Mirrors FileSystemFileEmitter's existing
 * "escapes the project root" guard.
 */
export function isContainedRelativePath(rel: string): boolean {
  if (path.isAbsolute(rel)) return false;
  const normalized = path.normalize(rel);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}
