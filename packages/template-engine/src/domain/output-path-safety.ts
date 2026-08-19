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
 *
 * Written as posix segment arithmetic: `node:path` is banned in domain
 * (`node-builtin-in-layer`). Matches `path.posix.isAbsolute` +
 * `path.posix.normalize` then reject `..` / `../…`.
 */
export function isContainedRelativePath(rel: string): boolean {
  // Native `path.join` on Windows treats `\` as a separator and `C:` as a
  // drive. The domain cannot import `node:path`; rejecting those forms here
  // is what keeps `file-system-template-file-loader` from joining an
  // escape that the posix walk would otherwise see as a single segment.
  if (rel.includes("\\") || /^[A-Za-z]:/.test(rel)) return false;
  if (rel.startsWith("/")) return false;
  let depth = 0;
  for (const raw of rel.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      if (depth === 0) return false;
      depth -= 1;
      continue;
    }
    depth += 1;
  }
  return true;
}
