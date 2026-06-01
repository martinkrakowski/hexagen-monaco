import path from "node:path";

/**
 * Relative path to the installed `hexagen-lint` bin, platform-aware.
 *
 * The bin name is scope-agnostic, so this resolves both in this monorepo
 * (`@hexagen/arch-linter`) and in a generated project (the
 * `@hexagen-monaco/arch-linter` devDependency). On Windows the package-manager
 * shim is `hexagen-lint.cmd`; on posix it's the extensionless symlink. Callers
 * run it with `cwd` set to the project root, against which this path resolves.
 */
export function archLinterBinPath(): string {
  const bin =
    process.platform === "win32" ? "hexagen-lint.cmd" : "hexagen-lint";
  return path.join("node_modules", ".bin", bin);
}
