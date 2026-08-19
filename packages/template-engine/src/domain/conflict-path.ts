/**
 * Derive the conflict copy path for a generated file, preserving the original
 * extension so IDEs retain syntax highlighting.
 *
 * Examples:
 *   rate-limit.ts  → rate-limit.hexagen-update.ts
 *   package.json   → package.hexagen-update.json
 *   Dockerfile     → Dockerfile.hexagen-update
 *   .env           → .env.hexagen-update
 *
 * Extension detection is posix segment arithmetic (same as `path.posix.extname`).
 * `node:path` is banned in domain (`node-builtin-in-layer`).
 */

/** Trailing `/` is ignored the same way `path.posix.extname` ignores it. */
function posixExtname(filePath: string): string {
  let end = filePath.length;
  while (end > 0 && filePath.charCodeAt(end - 1) === 47) end -= 1;
  const baseStart = filePath.lastIndexOf("/", end - 1) + 1;
  const base = filePath.slice(baseStart, end);
  if (base === "." || base === "..") return "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot);
}

export function conflictFilePath(filePath: string): string {
  const ext = posixExtname(filePath);
  return ext
    ? filePath.slice(0, -ext.length) + ".hexagen-update" + ext
    : filePath + ".hexagen-update";
}
