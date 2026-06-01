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
 * Returns an absolute path, or **`null`** if no installed bin is found while
 * walking up. Callers must handle `null` explicitly — running a non-existent
 * path through a shell yields a generic "command not found" (exit 127), which is
 * indistinguishable from a real lint failure, so the missing-bin case is
 * reported separately ("arch-linter not installed", not "architecture invalid").
 */
export function resolveArchLinterBin(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, "node_modules", ".bin", BIN_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
