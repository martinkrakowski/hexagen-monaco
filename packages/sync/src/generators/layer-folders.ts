import path from "node:path";
import yaml from "js-yaml";
import fs from "node:fs/promises";
import { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { isInScope } from "../fs-utils.js";

// Typed shape for layers from .architecture/manifest.yaml
interface LayerConfig {
  folder: string;
  subfolders?: string[];
}

/**
 * Truthful-counts probe (PR-B2, RCA #5): is there already a DIRECTORY at
 * `dirPath`? `mkdir` with `recursive: true` never throws `EEXIST` for an
 * existing directory, so the old catch→`skipped` branches here were dead and
 * every run counted every layer/subfolder mkdir as `created` — the RCA's
 * constant "67–70 created" on a fully converged tree, scaling with
 * contexts × layers × subfolders. A path that exists as a *file* reports
 * `false`, so the mkdir below throws `EEXIST` loudly instead of the old
 * silent count-as-skipped.
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch (e: unknown) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }
    throw e;
  }
}

/**
 * Create `dirPath` only if it is actually absent, and count it as `created`
 * only then (PR-B2). Dry-run plans the same way it would act: an absent
 * directory logs "would create" and counts; an existing one is silent — a
 * converged tree contributes ZERO ops here, which `sync --check` relies on.
 */
async function ensureDirectoryCounted(
  dirPath: string,
  config: SyncConfig,
  result: GeneratorResult,
): Promise<void> {
  const existed = await directoryExists(dirPath);
  if (existed) return;

  const relativePath = path.relative(config.workspaceRoot, dirPath);
  if (config.dryRun) {
    config.logger.info(`[DRY-RUN] would create directory ${relativePath}`);
  } else {
    await fs.mkdir(dirPath, { recursive: true });
    config.logger.info(`created directory ${relativePath}`);
  }
  result.created.push(dirPath);
  result.totalOps += 1;
}

/**
 * Safely load a YAML file, returning null if the file doesn't exist.
 */
async function loadYamlSafe<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return yaml.load(content) as T;
  } catch (e: unknown) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw e;
  }
}

/**
 * Ensures layer DIRECTORIES exist for a module (domain, application,
 * infrastructure, plus configured subfolders). Directories are this
 * generator's ONLY deliverable.
 *
 * Barrel single-ownership (PR-B2, the second half of RCA #5): this generator
 * used to also write barrels — a naive re-export-everything index.ts per
 * layer and an empty one per subfolder. The recursive-barrels generator then
 * rewrote every layer barrel to its own canonical content and deleted every
 * empty subfolder barrel on the SAME run, every run. At rest the tree was
 * byte-converged, but a dry-run/--check re-planned that churn each time
 * (8 creates + 6 updates on the contract fixture): permanent phantom drift
 * that no amount of count-fixing could zero out. Barrels now have exactly one
 * owner — generators/barrels/recursive.ts — which already covers the
 * empty-layer case this generator's barrels existed for (its walkDirectory
 * creates an `export {};` barrel in an empty layer directory and migrates the
 * legacy "No exports yet" content). Same single-writer doctrine as
 * cross-context.
 */
export async function ensureLayerFolders(
  moduleDir: string,
  layers: Record<string, LayerConfig>,
  config: SyncConfig,
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  const { logger } = config;

  // Load architectural invariants with graceful fallback
  const layerRulesPath = path.join(
    config.workspaceRoot,
    ".architecture",
    "invariants",
    "layer-rules.yaml",
  );
  const layerRules =
    await loadYamlSafe<Record<string, unknown>>(layerRulesPath);

  if (!layerRules) {
    logger.warn("layer-rules.yaml not found — skipping layer rule enforcement");
  }

  for (const [, layerConfig] of Object.entries(layers)) {
    const layerPath = path.join(moduleDir, layerConfig.folder);

    // Under --only, a layer is in scope when EITHER its directory path
    // matches (plain `--only packages/billing` prefix patterns) OR its barrel
    // path does. The barrel-path arm is load-bearing, not legacy courtesy
    // (review fix): pre-B2 this guard matched the barrel path, and file-deep
    // patterns like `--only packages/billing/src/domain/index.ts` relied on
    // it — the recursive-barrels owner can only plan a barrel inside a
    // directory that EXISTS on disk (it skips missing layer dirs), so a
    // directory-only guard silently disabled those patterns: no dir, no
    // barrel, exit 0. The mkdir stays a counted op, so out-of-scope runs
    // still contribute zero ops. Known preview limit: with a file-deep
    // pattern on a missing dir, --dry-run plans the dir create but cannot
    // plan the barrel the real run will then produce (the dry-run never
    // materializes the dir for the recursive pass to walk) — the real run
    // converges, and a follow-up --check reports zero.
    if (
      !isInScope(layerPath, config) &&
      !isInScope(path.join(layerPath, "index.ts"), config)
    ) {
      continue;
    }

    // PR-A2 gated this mkdir under dry-run; PR-B2 (RCA #5) fixed the
    // accounting: probe first, create-and-count only when actually absent
    // (see ensureDirectoryCounted — the old dead-EEXIST counting lived here).
    await ensureDirectoryCounted(layerPath, config, result);

    // Recurse into subfolders
    const subfolders = layerConfig.subfolders ?? [];
    for (const sub of subfolders) {
      const subPath = path.join(layerPath, sub);

      // Same two-arm scope guard as the parent layer (counted mkdir).
      if (
        !isInScope(subPath, config) &&
        !isInScope(path.join(subPath, "index.ts"), config)
      ) {
        continue;
      }

      // Same probe-first create-and-count as the parent layer above (PR-B2).
      await ensureDirectoryCounted(subPath, config, result);
    }
  }

  return result;
}
