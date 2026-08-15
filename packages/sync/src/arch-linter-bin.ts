import fs from "node:fs";
import path from "node:path";

const BIN_NAME =
  process.platform === "win32" ? "hexagen-lint.cmd" : "hexagen-lint";

/**
 * Package names the linter ships under, newest first: `@hexagen-monaco/*` is
 * the published package a generated project installs; `@hexagen/*` is the
 * workspace name inside this monorepo.
 */
const PACKAGE_NAMES = [
  "@hexagen-monaco/arch-linter",
  "@hexagen/arch-linter",
] as const;

/** Reads `bin["hexagen-lint"]` (or a bare string `bin`) out of a package.json. */
function binEntryOf(pkgJsonPath: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const bin = (parsed as { bin?: unknown }).bin;
  if (typeof bin === "string") return bin;
  if (typeof bin === "object" && bin !== null) {
    const entry = (bin as Record<string, unknown>)["hexagen-lint"];
    if (typeof entry === "string") return entry;
  }
  return null;
}

/**
 * Fallback resolution: find the arch-linter **package** under `<dir>/node_modules`
 * and return the file its `bin` field points at.
 *
 * Needed because Yarn creates a `node_modules/.bin/` entry only for a bin whose
 * target file exists **at install time** — when it does not, no entry is written
 * at all (not even a dangling link). The linter's bin target is a build artifact
 * absent from a fresh checkout, and CI installs exactly once, *before* the first
 * build, so the shim was never created and the strict architecture gate could
 * only ever report "arch-linter not installed" (AUD-010). Whether some workspace
 * declares the linter as a dependency makes no difference; only the target's
 * existence at install time does.
 *
 * Resolution is by bin **name**, read from the package's own `bin` field, so it
 * follows the target wherever that package points it — no path is assumed here.
 * Still existence-checked: an unbuilt linter must resolve to `null` ("could not
 * verify"), never to a path that fails obscurely at exec.
 */
function resolveFromPackage(dir: string): string | null {
  for (const pkgName of PACKAGE_NAMES) {
    const pkgDir = path.join(dir, "node_modules", ...pkgName.split("/"));
    const entry = binEntryOf(path.join(pkgDir, "package.json"));
    if (entry === null) continue;
    const binPath = path.join(pkgDir, entry);
    if (fs.existsSync(binPath)) return binPath;
  }
  return null;
}

/**
 * Resolve the installed `hexagen-lint` bin by walking up from `startDir`,
 * preferring the `node_modules/.bin/` shim and falling back to the arch-linter
 * package's own `bin` target at the same level.
 *
 * The shim name is scope-agnostic, so it resolves both in this monorepo
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
 *
 * The returned path may be a shell-executable shim OR a plain `.js` entrypoint;
 * build the command with {@link archLinterCommand} rather than quoting it
 * directly.
 */
export function resolveArchLinterBin(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, "node_modules", ".bin", BIN_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const fromPackage = resolveFromPackage(dir);
    if (fromPackage !== null) return fromPackage;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Build the shell command that runs a resolved arch-linter bin.
 *
 * A `node_modules/.bin/` shim is directly executable (posix symlink with a
 * shebang, or a `.cmd` batch file on Windows), but the package-level fallback
 * resolves to a raw `.js` module — which only runs by file association, if at
 * all, on Windows. Launching those through the current interpreter keeps both
 * resolution paths behaving identically on every platform. Quoted so an
 * absolute path containing spaces survives the shell.
 */
export function archLinterCommand(
  bin: string,
  execPath: string = process.execPath,
): string {
  return /\.[cm]?js$/i.test(bin) ? `"${execPath}" "${bin}"` : `"${bin}"`;
}
