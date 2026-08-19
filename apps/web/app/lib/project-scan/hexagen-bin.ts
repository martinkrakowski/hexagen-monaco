import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const BIN_NAME = "hexagen";

function binEntryOf(pkgJsonPath: string, binName: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const bin = (parsed as { bin?: unknown }).bin;
  if (typeof bin === "string") return bin;
  if (typeof bin === "object" && bin !== null) {
    const entry = (bin as Record<string, unknown>)[binName];
    if (typeof entry === "string") return entry;
  }
  return null;
}

/**
 * Resolve the workspace `hexagen` binary from `workspaceRoot` (the monorepo
 * root from {@link findMonorepoRoot}), never `process.cwd()` of apps/web.
 *
 * Order:
 *   1. `packages/sync`'s own `package.json` `bin.hexagen` (this monorepo)
 *   2. `node_modules/.bin/hexagen` shim at the workspace root
 *   3. `node_modules/@hexagen/sync`'s `bin.hexagen`
 *
 * Returns an absolute path, or `null` if nothing exists on disk. Callers must
 * treat `null` as `could-not-run`, not as a spawn of a missing path.
 */
export function resolveHexagenBin(workspaceRoot: string): string | null {
  const syncPkg = path.join(workspaceRoot, "packages", "sync", "package.json");
  const fromWorkspacePkg = binEntryOf(syncPkg, BIN_NAME);
  if (fromWorkspacePkg !== null) {
    const candidate = path.join(
      workspaceRoot,
      "packages",
      "sync",
      fromWorkspacePkg,
    );
    if (existsSync(candidate)) return candidate;
  }

  const shim = path.join(workspaceRoot, "node_modules", ".bin", BIN_NAME);
  if (existsSync(shim)) return shim;

  const installedPkg = path.join(
    workspaceRoot,
    "node_modules",
    "@hexagen",
    "sync",
    "package.json",
  );
  const fromInstalled = binEntryOf(installedPkg, BIN_NAME);
  if (fromInstalled !== null) {
    const candidate = path.join(
      workspaceRoot,
      "node_modules",
      "@hexagen",
      "sync",
      fromInstalled,
    );
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * argv-style spawn for `hexagen scan --yes --root <tmp>`.
 *
 * A `.js` entry (packages/sync/dist/cli.js) is launched through the current
 * Node interpreter so execFile stays shell-free on posix. A `.bin` shim is
 * executable on its own. Either way the argv array includes `scan`, `--yes`,
 * and `--root` — never a concatenated shell string.
 */
export function hexagenScanArgv(
  bin: string,
  root: string,
  execPath: string = process.execPath,
): { file: string; args: string[] } {
  const scanArgs = ["scan", "--yes", "--root", root];
  if (/\.[cm]?js$/i.test(bin)) {
    return { file: execPath, args: [bin, ...scanArgs] };
  }
  return { file: bin, args: scanArgs };
}
