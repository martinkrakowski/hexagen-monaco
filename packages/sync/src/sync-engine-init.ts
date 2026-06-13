import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SyncFlags } from "./config.js";
import type { Manifest } from "./types/manifest.js";
import { ManifestSchema } from "@hexagen/project-configuration";
import { mergeSplitManifest } from "./loaders/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export { __dirname };

export interface InitOptions {
  targetRoot?: string;
  manifest?: Manifest;
}

function isENOENT(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

/**
 * Walk up from `startDir` looking for a package.json with a `workspaces`
 * array. Returns the containing directory, or null when the walk reaches the
 * filesystem root without a hit. (The filesystem root itself is deliberately
 * not probed — same bound as the pre-refactor walk.)
 *
 * ENOENT (no package.json here) is the expected case and stays silent. Any
 * OTHER obstacle — EACCES, malformed JSON — is pushed into `problems` so an
 * exhausted walk can name the real cause instead of misreporting it as the
 * generic "no workspaces array" (the pre-fix blanket catch swallowed these).
 */
async function findRootFrom(
  startDir: string,
  problems: Error[],
): Promise<string | null> {
  let currentDir = startDir;
  while (currentDir !== path.parse(currentDir).root) {
    const pkgPath = path.join(currentDir, "package.json");
    try {
      const pkgContent = await fs.readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgContent) as { workspaces?: unknown[] };
      if (pkg.workspaces && Array.isArray(pkg.workspaces)) {
        return currentDir;
      }
    } catch (err) {
      if (!isENOENT(err)) {
        const reason = err instanceof Error ? err.message : String(err);
        problems.push(new Error(`${pkgPath}: ${reason}`));
      }
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}

/**
 * Resolve the workspace root (Wave-C consumer experience, RCA #7):
 * `options.targetRoot` wins (programmatic callers — the wizard's external
 * mode, tests); otherwise walk up from each probe start in order and return
 * the first directory whose package.json declares a `workspaces` array.
 *
 * Probe order is cwd FIRST, install location second:
 *  - cwd-first is the CLI convention (git/npm/turbo all operate on where you
 *    are), and it is the only start that works for a global or `npx` install,
 *    where __dirname lives in a cache directory whose walk-up finds nothing —
 *    the old __dirname-only walk hard-failed there with a terse error that
 *    never named the real problem.
 *  - The __dirname fallback preserves every previously-working setup: a
 *    locally installed CLI invoked from OUTSIDE its workspace (cwd resolves
 *    nothing) still finds the workspace it is installed in.
 *
 * `probeStarts` is parameterized for tests only; production callers use the
 * default.
 */
export async function findWorkspaceRoot(
  options: InitOptions,
  probeStarts: readonly string[] = [process.cwd(), __dirname],
): Promise<string> {
  if (options.targetRoot) {
    return options.targetRoot;
  }

  const problems: Error[] = [];
  for (const start of probeStarts) {
    const root = await findRootFrom(start, problems);
    if (root !== null) {
      return root;
    }
  }

  const detail =
    problems.length > 0
      ? ` A package.json was found but could not be read or parsed: ${problems[0].message}.`
      : "";
  throw new Error(
    'Could not locate monorepo root: no package.json with a "workspaces" array ' +
      `found walking up from ${probeStarts.join(" or ")}.${detail} ` +
      "Run the command from inside your workspace (any subdirectory works), " +
      'and check that the root package.json declares "workspaces". Note: a ' +
      "globally- or npx-installed CLI can only resolve the root from your " +
      "current directory.",
  );
}

export async function loadManifest(
  workspaceRoot: string,
  flags: SyncFlags,
  options: InitOptions,
): Promise<{ manifest: Manifest; manifestMissing: boolean }> {
  if (options.manifest) {
    return { manifest: options.manifest, manifestMissing: false };
  }

  const { logger, dryRun } = flags;
  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");
  logger.debug(`[debug] __dirname (ESM): ${__dirname}`);
  logger.debug(`[debug] resolved workspaceRoot: ${workspaceRoot}`);
  logger.debug(`[debug] resolved manifestPath: ${manifestPath}`);

  try {
    const manifest = (await mergeSplitManifest(
      workspaceRoot,
      manifestPath,
    )) as Manifest;
    logger.info(`Loaded manifest from ${manifestPath}`);
    return { manifest, manifestMissing: false };
  } catch (err) {
    if (isENOENT(err) && dryRun) {
      // Dry-run tolerates an absent manifest so a preview still runs; the
      // synthesized-empty fact rides out in the SyncRunSummary so a `--check`
      // gate can refuse to certify drift against a manifest that isn't there.
      logger.warn(`Manifest not found — using empty for dry-run`);
      return {
        manifest: { description: "Empty manifest", bounded_contexts: [] },
        manifestMissing: true,
      };
    }
    const message = err instanceof Error ? err.message : "Unknown parse error";
    throw new Error(`Failed to parse manifest: ${message}`);
  }
}

export function validateManifest(manifest: Manifest, flags: SyncFlags): void {
  const { logger } = flags;
  const contexts = manifest.bounded_contexts ?? [];

  const names = contexts.map((c) => c.name).filter(Boolean);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);

  if (duplicates.length > 0) {
    throw new Error(
      `Invalid manifest: duplicate bounded context names: ${duplicates.join(", ")}`,
    );
  }

  for (const ctx of contexts) {
    if (!ctx?.name) {
      logger.warn("Skipping bounded context with missing name");
      continue;
    }
    if (!ctx?.type) {
      logger.warn(`Bounded context "${ctx.name}" missing type field`);
    }
  }

  try {
    ManifestSchema.parse(manifest);
    logger.debug("[Manifest] Zod Schema Validation passed");
  } catch (err) {
    if (err instanceof Error) {
      logger.warn(`[Manifest] Schema Validation warning: ${err.message}`);
    }
  }

  logger.debug("[Manifest] Validation passed");
}
