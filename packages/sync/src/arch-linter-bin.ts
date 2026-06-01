import fs from "node:fs";
import path from "node:path";

const BIN_NAME =
  process.platform === "win32" ? "hexagen-lint.cmd" : "hexagen-lint";

/**
 * Resolve the installed `hexagen-lint` bin by walking up from `startDir` to the
 * nearest `node_modules/.bin/`.
 *
 * The bin name is scope-agnostic, so this resolves both in this monorepo
 * (`@hexagen/arch-linter`) and in a generated project (the
 * `@hexagen-monaco/arch-linter` devDependency). Walking up matters because the
 * project root — where `.architecture/manifest.yaml` lives — isn't guaranteed to
 * be the directory where dependencies were installed (e.g. a nested package
 * whose `node_modules` is hoisted to a parent). Platform-aware: `.cmd` shim on
 * Windows, extensionless symlink on posix.
 *
 * Returns an absolute path. If no installed bin is found while walking up,
 * returns the co-located candidate so the caller surfaces a clear ENOENT rather
 * than silently skipping validation.
 */
export function resolveArchLinterBin(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, "node_modules", ".bin", BIN_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.join(
        path.resolve(startDir),
        "node_modules",
        ".bin",
        BIN_NAME,
      );
    }
    dir = parent;
  }
}
