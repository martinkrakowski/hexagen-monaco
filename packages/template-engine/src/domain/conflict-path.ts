import path from "node:path";

/**
 * Derive the conflict copy path for a generated file, preserving the original
 * extension so IDEs retain syntax highlighting.
 *
 * Examples:
 *   rate-limit.ts  → rate-limit.hexagen-update.ts
 *   package.json   → package.hexagen-update.json
 *   Dockerfile     → Dockerfile.hexagen-update
 *   .env           → .hexagen-update.env
 */
export function conflictFilePath(filePath: string): string {
  const ext = path.extname(filePath);
  return ext
    ? filePath.slice(0, -ext.length) + ".hexagen-update" + ext
    : filePath + ".hexagen-update";
}
