import path from "node:path";
import yaml from "js-yaml";
import fs from "node:fs/promises";
import { SyncConfig } from "../config.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
} from "../results.js";
import { isInScope, safeWriteFileAtomic } from "../fs-utils.js";
import {
  isSafeLayerFolder,
  layerDeclaresContent,
  normalizeSubfolder,
  resolveLayerDir,
} from "../domain/services/layer-dir-resolver.js";
import type { BoundedContextLayers } from "../types/manifest.js";

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
 * Keep a LEAF layer directory trackable by git (Wave-C consumer experience —
 * the campaign-foundry CI incident): git cannot represent an empty directory,
 * so a freshly scaffolded layer skeleton existed in every working copy but in
 * no fresh checkout. The first consumer to wire `sync --check` into CI got
 * "Drift detected: 22 pending change(s)" — all `would create directory` — on
 * a tree that was fully converged locally. Emitting `.gitkeep` makes the
 * scaffold commit-able, so working copy and fresh checkout agree.
 *
 * UNCONDITIONAL in both modes, deliberately against the external-only-gate
 * precedent (package-root barrel, shared Result kernel): the consumer CLI
 * runs in self-regen mode (config.ts's default), so an external-only gate
 * would miss the actual victim. Self-regen on a mature repo is unaffected in
 * practice — a directory with real entries is silent below.
 *
 * Conservative rules (each refusal avoids a permanent phantom op or litter):
 *  - a dir with real entries gets NO record at all — git already tracks it
 *    via its content (same silence as ensureDirectoryCounted on an existing
 *    dir, and same reason: nothing was or would be done);
 *  - an existing keep with hand-written content is left byte-untouched and
 *    unrecorded — its one job (keeping the dir) is done, and rewriting it to
 *    "" would plan a phantom `update` on every `--check` forever;
 *  - stale keeps (real files arrived later) are never deleted.
 *
 * Dry-run parity: an absent dir (only reachable under --dry-run — the real
 * run materialized it in ensureDirectoryCounted first) plans the keep through
 * the same `safeWriteFileAtomic` the real run uses, so preview and real run
 * count identically. Under a file-deep `--only` pattern the keep path itself
 * is out of scope and lands in `skipped` — same documented convergence limit
 * as the dir/barrel preview note in `ensureLayerFolders`.
 */
async function ensureGitkeepCounted(
  dirPath: string,
  config: SyncConfig,
  result: GeneratorResult,
): Promise<void> {
  const keepPath = path.join(dirPath, ".gitkeep");

  let entries: string[] | null = null;
  if (await directoryExists(dirPath)) {
    entries = await fs.readdir(dirPath);
  }

  if (entries !== null) {
    const keepIsOnlyEntry = entries.length === 1 && entries[0] === ".gitkeep";
    if (entries.length > 0 && !keepIsOnlyEntry) {
      // Real content tracks the dir — silent, like an existing dir.
      return;
    }
    if (keepIsOnlyEntry) {
      const existing = await fs.readFile(keepPath, "utf8").catch(() => null);
      if (existing !== null && existing !== "") {
        // Hand-written keep content — leave untouched, unrecorded.
        return;
      }
    }
  }

  // skipGeneratedCheck: an empty file cannot carry the @generated marker, so
  // the hand-written-preserve check must never adjudicate it. Every path that
  // reaches this write is absent-or-empty (content-bearing keeps returned
  // above), so the flag is belt-and-braces, not a clobber license.
  const status = await safeWriteFileAtomic(
    keepPath,
    "",
    config,
    undefined,
    true,
  );
  recordWriteStatus(result, keepPath, status);
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
 * infrastructure, plus configured subfolders), and a `.gitkeep` in each LEAF
 * directory so the scaffold survives a git checkout (see
 * ensureGitkeepCounted). Leaf-only and config-derived: a configured dir with
 * NO configured subfolders gets the keep; a parent layer dir is materialized
 * transitively by its subfolders' keeps. Deriving leaves from the CONFIG
 * (not from what's on disk) is what guarantees dry-run parity — an absent
 * tree plans exactly the keeps a real run writes.
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
 *
 * Wave C 6.7(a) / HEX-025 / ADR-0050 Decision 1: a configured layer is
 * emitted only when `contextLayers` lists real content for it. Unused
 * layers (missing `layers:`, empty objects, empty arrays) are not created
 * and not planned as created — on Hexagen self-regen and on foreign trees
 * alike. Fail-closed when `contextLayers` is omitted. Used-layer
 * `.gitkeep` / leaf-tracking is unchanged.
 */
export async function ensureLayerFolders(
  moduleDir: string,
  layers: Record<string, LayerConfig>,
  config: SyncConfig,
  contextLayers?: BoundedContextLayers,
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

  for (const [layerName, layerConfig] of Object.entries(layers)) {
    // Unused layers contribute ZERO ops — not created, not planned as
    // created. The predicate is YAML-content, not "folder already on
    // disk": a foreign tree with `generator.sync.layers` armed and no
    // `layers:` block must stay silent (6.7(a) external-repo gate).
    if (!layerDeclaresContent(layerName, contextLayers)) {
      continue;
    }

    // Resolver-validated (review fix): an absolute or `..`-traversing
    // configured folder falls back to the `src/<layer>` convention instead of
    // escaping the package. Every emitter already went through the resolver;
    // the scaffold was the one consumer still joining the raw configured
    // folder.
    const layerPath = path.join(moduleDir, resolveLayerDir(layers, layerName));

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

    const subfolders = layerConfig.subfolders ?? [];

    // Leaf rule: only dirs at the bottom of the CONFIGURED tree get a keep —
    // a layer dir with subfolders is kept transitively by their keeps.
    if (subfolders.length === 0) {
      await ensureGitkeepCounted(layerPath, config, result);
    }

    // Recurse into subfolders. Known-site spellings are normalized to the
    // conventional kebab-case form (F16): the wizard's layer config names
    // `value_objects` while stub emission and the add-on template payloads
    // (and their import specifiers) use `value-objects` — scaffolding the
    // configured spelling verbatim produced BOTH folders, one holding only
    // this generator's `.gitkeep`. One site, one folder.
    for (const sub of subfolders) {
      const normalizedSub = normalizeSubfolder(sub);

      // Same traversal posture as the layer folder above (review fix): a
      // configured subfolder that is absolute or `..`-traverses is skipped —
      // there is no conventional fallback name for a custom subfolder.
      if (!isSafeLayerFolder(normalizedSub)) {
        logger.warn(
          `Skipping unsafe configured subfolder "${sub}" in layer "${layerName}"`,
        );
        continue;
      }

      const subPath = path.join(layerPath, normalizedSub);

      // Same two-arm scope guard as the parent layer (counted mkdir).
      if (
        !isInScope(subPath, config) &&
        !isInScope(path.join(subPath, "index.ts"), config)
      ) {
        continue;
      }

      // Same probe-first create-and-count as the parent layer above (PR-B2).
      await ensureDirectoryCounted(subPath, config, result);

      // Every configured subfolder is a leaf (LayerConfig nests one level).
      await ensureGitkeepCounted(subPath, config, result);
    }
  }

  return result;
}
