import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { SyncFlags, SyncConfig } from "./config.js";
import { MigrationReport } from "./migration-report.js";
import { LockFile } from "./lock.js";

import { runArchLinter } from "./linter.js";
import { ensureLayerFolders } from "./generators/layer-folders.js";
import { generateBarrels } from "./generators/barrels.js";
import { generatePackageJson } from "./generators/package-json.js";
import { generateTsconfig } from "./generators/tsconfig.js";
import { reapLegacyFolders } from "./generators/reap.js";
import { generateRootFiles } from "./generators/root-files.js";
import { generateArchitectureFiles } from "./generators/architecture-files.js";
import { generateApps } from "./generators/apps.js";
import { generateEslintConfig } from "./generators/eslint.js";
import { generateStubs } from "./generators/stubs.js";
import { createEmptyResult, type GeneratorResult } from "./results.js";
import type { Manifest } from "./types/manifest.js";
import { ensureDependenciesBuilt } from "./preflight.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// Structured return type aggregating every generator's output across the run.
// `barrels` is combined across BOTH the first-pass (pre-stubs) and
// second-pass (post-stubs) barrel generations — see `generateCoreArtifacts`
// and the second-pass block in `run()` for the ordering rationale.
interface GeneratorResults {
  rootFiles: GeneratorResult;
  archFiles: GeneratorResult;
  barrels: GeneratorResult;
  pkgs: GeneratorResult;
  tsconfigs: GeneratorResult;
  eslint: GeneratorResult;
  stubs: GeneratorResult;
  apps: GeneratorResult;
  totalOps: number;
}

/**
 * Merge a source {@link GeneratorResult} into a destination accumulator,
 * concatenating path arrays and summing `totalOps`. Used to aggregate the
 * per-module results produced inside `generateCoreArtifacts`.
 */
function mergeResult(dest: GeneratorResult, src: GeneratorResult): void {
  dest.created.push(...src.created);
  dest.updated.push(...src.updated);
  dest.skipped.push(...src.skipped);
  dest.totalOps += src.totalOps;
}

/**
 * Merge a second barrel pass into the accumulated first-pass result with
 * second-pass-wins semantics for file-path classification.
 *
 * Rationale: each barrel file is visited by both passes. Pass 1 runs before
 * stubs exist and may classify a barrel as `created`/`updated`; pass 2 runs
 * after stubs and is the authoritative view of final disk state for that
 * path. Duplicating paths across buckets would inflate the summary counts
 * and mislead operators. `totalOps`, however, is summed across both passes
 * because each pass performs real atomic writes and its individual op count
 * is a faithful record of work done.
 */
function mergeBarrelPasses(
  firstPass: GeneratorResult,
  secondPass: GeneratorResult,
): GeneratorResult {
  const combined = createEmptyResult();
  // Index the second pass by path → bucket so it wins on any overlap.
  const secondPaths = new Set<string>([
    ...secondPass.created,
    ...secondPass.updated,
    ...secondPass.skipped,
  ]);
  for (const p of firstPass.created) {
    if (!secondPaths.has(p)) combined.created.push(p);
  }
  for (const p of firstPass.updated) {
    if (!secondPaths.has(p)) combined.updated.push(p);
  }
  for (const p of firstPass.skipped) {
    if (!secondPaths.has(p)) combined.skipped.push(p);
  }
  combined.created.push(...secondPass.created);
  combined.updated.push(...secondPass.updated);
  combined.skipped.push(...secondPass.skipped);
  combined.totalOps = firstPass.totalOps + secondPass.totalOps;
  return combined;
}

export interface SyncEngineOptions {
  targetRoot?: string;
  manifest?: Manifest;
}

/**
 * Central orchestrator — ALL generators return structured GeneratorResult.
 */
export class SyncEngine {
  private report = new MigrationReport();
  private partialConfig: SyncFlags;
  private fullConfig: SyncConfig | null = null;
  private manifest: Manifest = {};
  private workspaceRoot: string = "";
  private readonly options?: SyncEngineOptions;

  constructor(flags: SyncFlags, options?: SyncEngineOptions) {
    this.partialConfig = flags;
    this.options = options;
  }

  private async findWorkspaceRoot(): Promise<string> {
    if (this.options?.targetRoot) {
      return this.options.targetRoot;
    }

    let currentDir = __dirname;
    while (currentDir !== path.parse(currentDir).root) {
      try {
        const pkgPath = path.join(currentDir, "package.json");
        const pkgContent = await fs.readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent) as { workspaces?: unknown[] };
        if (pkg.workspaces && Array.isArray(pkg.workspaces)) {
          return currentDir;
        }
      } catch {
        // silent — not this directory
      }
      currentDir = path.dirname(currentDir);
    }
    throw new Error(
      'Could not locate monorepo root. No package.json with "workspaces" field found.',
    );
  }

  private async loadManifest(): Promise<void> {
    if (this.options?.manifest) {
      this.manifest = this.options.manifest;
      return;
    }

    const { logger, dryRun } = this.partialConfig;
    const manifestPath = path.join(
      this.workspaceRoot,
      ".architecture/manifest.yaml",
    );
    logger.debug(`[debug] __dirname (ESM): ${__dirname}`);
    logger.debug(`[debug] resolved workspaceRoot: ${this.workspaceRoot}`);
    logger.debug(`[debug] resolved manifestPath: ${manifestPath}`);

    try {
      await fs.access(manifestPath);
      logger.debug("[debug] fs.access succeeded");
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        err.code === "ENOENT" &&
        dryRun
      ) {
        logger.warn(`Manifest not found — using empty for dry-run`);
        this.manifest = { bounded_contexts: [] };
        return;
      }
      throw err;
    }

    try {
      const content = await fs.readFile(manifestPath, "utf8");
      const loaded = yaml.load(content);
      this.manifest = (loaded as Manifest) ?? {};
      logger.info(`Loaded manifest from ${manifestPath}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown parse error";
      throw new Error(`Failed to parse manifest: ${message}`);
    }
  }

  private validateManifest(): void {
    const { logger } = this.partialConfig;
    const contexts = this.manifest.bounded_contexts ?? [];

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

    logger.debug("[Manifest] Validation passed");
  }

  private getConfig(): SyncConfig {
    if (!this.fullConfig) {
      throw new Error("SyncEngine config not initialized. Call run() first.");
    }
    return this.fullConfig;
  }

  private async ensureDirectories(): Promise<GeneratorResult> {
    const config = this.getConfig();
    const result = createEmptyResult();
    const { logger } = config;
    const layers = config.manifest.generator?.sync?.layers ?? {};
    const modules = config.manifest.bounded_contexts ?? [];

    for (const mod of modules) {
      if (!mod?.name) continue;

      // Validate moduleName (prevent path traversal)
      if (
        mod.name.includes("..") ||
        mod.name.includes("/") ||
        mod.name.startsWith(".")
      ) {
        logger.warn(
          `Skipping invalid module name (potential path traversal): ${mod.name}`,
        );
        continue;
      }

      const moduleDir = path.join(this.workspaceRoot, "packages", mod.name);
      logger.info(
        `Ensuring directories for module: ${mod.name} at ${moduleDir}`,
      );

      const layerResult = await ensureLayerFolders(
        moduleDir,
        layers,
        config,
        this.report,
      );
      result.created.push(...layerResult.created);
      result.skipped.push(...layerResult.skipped);
      result.updated.push(...layerResult.updated);
      result.totalOps += layerResult.totalOps;
    }

    return result;
  }

  /**
   * First-pass content generation for every bounded context. Produces (in
   * order per module): first-pass barrels, package.json, tsconfig, eslint
   * config, then stubs. Stubs run LAST in this loop so that the second
   * barrel pass (in `run()`) can re-export any newly-created stub files.
   *
   * Note: the returned `barrels` field represents ONLY the first pass. The
   * engine's `run()` method performs a second barrel pass after this
   * function returns and merges both results via {@link mergeBarrelPasses}
   * before reporting.
   */
  private async generateCoreArtifacts(): Promise<GeneratorResults> {
    const config = this.getConfig();
    const { logger } = config;
    const modules = config.manifest.bounded_contexts ?? [];

    const barrels = createEmptyResult();
    const pkgs = createEmptyResult();
    const tsconfigs = createEmptyResult();
    const eslint = createEmptyResult();
    const stubs = createEmptyResult();

    for (const module of modules) {
      const moduleName = module.name;
      const moduleDir = path.join(this.workspaceRoot, "packages", moduleName);

      // Validate moduleName (prevent path traversal)
      if (
        moduleName.includes("..") ||
        moduleName.includes("/") ||
        moduleName.startsWith(".")
      ) {
        logger.warn(
          `Skipping invalid module name (potential path traversal): ${moduleName}`,
        );
        continue;
      }

      logger.info(`Processing module: ${moduleName}`);

      // 7a. First barrel pass — runs before stubs exist; a second pass in
      //     run() will re-scan after stubs are emitted.
      const barrelResult = await generateBarrels(
        moduleDir,
        config,
        this.report,
      );
      // 7b. package.json
      const pkgResult = await generatePackageJson(
        moduleDir,
        moduleName,
        config,
        this.report,
      );
      // 7c. tsconfig.json
      const tsResult = await generateTsconfig(
        moduleDir,
        moduleName,
        config,
        this.report,
      );
      // 7d. eslint.config.js (per-module)
      const eslintResult = await generateEslintConfig(
        moduleDir,
        moduleName,
        config,
        this.report,
      );
      // 7e. Stub scaffolding (per-module) — MUST run after tsconfig/eslint
      //     and before the second barrel pass.
      const stubResult = await generateStubs(
        moduleDir,
        moduleName,
        config,
        this.report,
      );

      // 7f. Reap legacy layer folders after successful generation for this
      //     module (skip in external mode).
      if (this.partialConfig.mode === "self-regen") {
        await reapLegacyFolders(moduleDir, config, this.report);
      }

      mergeResult(barrels, barrelResult);
      mergeResult(pkgs, pkgResult);
      mergeResult(tsconfigs, tsResult);
      mergeResult(eslint, eslintResult);
      mergeResult(stubs, stubResult);
    }

    return {
      rootFiles: createEmptyResult(),
      archFiles: createEmptyResult(),
      barrels,
      pkgs,
      tsconfigs,
      eslint,
      stubs,
      apps: createEmptyResult(),
      totalOps:
        barrels.totalOps +
        pkgs.totalOps +
        tsconfigs.totalOps +
        eslint.totalOps +
        stubs.totalOps,
    };
  }

  async run(): Promise<void> {
    const { logger, dryRun, allowDirty, mode } = this.partialConfig;
    const start = Date.now();
    let lockFile: LockFile | null = null;

    logger.info(
      dryRun ? "[DRY-RUN MODE] Starting sync..." : "Starting sync...",
    );

    // Ensure a clean git tree before mutating anything (unless --allow-dirty or external mode)
    if (mode === "self-regen" && !allowDirty) {
      try {
        const { stdout: gitStatus } = await execAsync(
          "git status --porcelain",
          {
            cwd: this.options?.targetRoot ?? process.cwd(),
          },
        );
        if (gitStatus && gitStatus.trim().length > 0) {
          logger.error(
            "Git working tree is dirty. Commit or stash changes, or use --allow-dirty to proceed.",
          );
          throw new Error("Dirty git tree");
        }
      } catch (gitErr) {
        if (gitErr instanceof Error) {
          if (gitErr.message.includes("not a git repository")) {
            logger.error("Git operation failed: not a git repository");
            throw new Error("Git operation failed: repository not found");
          }
          if ("code" in gitErr && gitErr.code === "ENOENT") {
            logger.error("Git operation failed: git command not found");
            throw new Error("Git operation failed: git not installed");
          }
          // Re-throw for outer handler
          throw gitErr;
        }
        throw new Error("Git operation failed: unknown error");
      }
    } else if (mode === "external") {
      logger.info("Skipping git check (external mode)");
    } else {
      logger.warn("Skipping git clean check (--allow-dirty)");
    }

    try {
      this.workspaceRoot = await this.findWorkspaceRoot();
      await this.loadManifest();
      this.validateManifest();

      this.fullConfig = {
        ...this.partialConfig,
        workspaceRoot: this.workspaceRoot,
        manifest: this.manifest,
      } as const;

      // Acquire file lock for generator.config.yaml (skip in dry-run and external mode)
      if (!dryRun && mode === "self-regen") {
        lockFile = new LockFile(this.workspaceRoot);
        try {
          await lockFile.acquire();
        } catch (lockErr) {
          logger.error(
            lockErr instanceof Error
              ? lockErr.message
              : "Failed to acquire lock",
          );
          throw new Error("Sync aborted: another sync is in progress");
        }
      }

      // Pre-flight: build any stale packages (skip in external mode)
      if (mode === "self-regen") {
        await ensureDependenciesBuilt(this.fullConfig!);
      } else {
        logger.info("Skipping preflight build (external mode)");
      }

      // === Phase 1: Structure ===
      // Step 4. Root files (package.json, tsconfig.base.json, turbo.json)
      //         MUST run before ensureDirectories so the monorepo skeleton
      //         exists before per-module generators touch it.
      const rootFilesResult = await generateRootFiles(
        this.fullConfig,
        this.report,
      );
      // Step 5. Architecture files (manifest.yaml snapshot, invariants/*,
      //         generator.config.yaml). Same ordering reason.
      const archFilesResult = await generateArchitectureFiles(
        this.fullConfig,
        this.report,
      );
      // Step 6. Per-module layer folders.
      const layerResult = await this.ensureDirectories();

      // === Phase 2: Content ===
      // Step 7. Per-module core artifacts: first-pass barrels, package.json,
      //         tsconfig, eslint, stubs, (self-regen reap).
      const coreResults = await this.generateCoreArtifacts();
      const { pkgs, tsconfigs, eslint, stubs } = coreResults;
      const firstPassBarrels = coreResults.barrels;
      // Step 8. Apps scaffolding — runs once, not per bounded-context.
      const appsResult = await generateApps(this.fullConfig, this.report);

      // === Phase 3: Second barrel pass ===
      // Step 9. Re-run barrels for every module now that stubs exist. This
      //         is the ordering fix that makes barrels re-export the
      //         stub files created in step 7e.
      const secondPassBarrels = createEmptyResult();
      const modules = this.fullConfig.manifest.bounded_contexts ?? [];
      for (const module of modules) {
        const moduleName = module.name;
        if (
          !moduleName ||
          moduleName.includes("..") ||
          moduleName.includes("/") ||
          moduleName.startsWith(".")
        ) {
          // Validation already emitted a warning in generateCoreArtifacts.
          continue;
        }
        const moduleDir = path.join(this.workspaceRoot, "packages", moduleName);
        const pass2 = await generateBarrels(
          moduleDir,
          this.fullConfig,
          this.report,
        );
        mergeResult(secondPassBarrels, pass2);
      }
      const barrels = mergeBarrelPasses(firstPassBarrels, secondPassBarrels);

      const totalOps =
        rootFilesResult.totalOps +
        archFilesResult.totalOps +
        layerResult.totalOps +
        barrels.totalOps +
        pkgs.totalOps +
        tsconfigs.totalOps +
        eslint.totalOps +
        stubs.totalOps +
        appsResult.totalOps;

      // Step 10/11. Arch linter + migration report (self-regen only).
      if (mode === "self-regen") {
        await runArchLinter(this.fullConfig);
        await this.report.writeReport(this.fullConfig!);
      } else {
        logger.info("Skipping arch-linter and report (external mode)");
      }

      const duration = Date.now() - start;

      logger.info("\nSync completed successfully.");
      logger.info(
        `Processed ${this.manifest.bounded_contexts?.length ?? 0} modules in ${duration}ms`,
      );
      logger.info(`\n=== Generator Summary ===`);
      logger.info(
        `• RootFiles : ${rootFilesResult.created.length} created, ${rootFilesResult.updated.length} updated, ${rootFilesResult.skipped.length} skipped`,
      );
      logger.info(
        `• ArchFiles : ${archFilesResult.created.length} created, ${archFilesResult.updated.length} updated, ${archFilesResult.skipped.length} skipped`,
      );
      logger.info(
        `• Layers : ${layerResult.created.length} created, ${layerResult.updated.length} updated, ${layerResult.skipped.length} skipped`,
      );
      logger.info(
        `• Barrels : ${barrels.created.length} created, ${barrels.updated.length} updated, ${barrels.skipped.length} skipped`,
      );
      logger.info(
        `• package.json : ${pkgs.created.length} created, ${pkgs.updated.length} updated, ${pkgs.skipped.length} skipped`,
      );
      logger.info(
        `• tsconfig.json : ${tsconfigs.created.length} created, ${tsconfigs.updated.length} updated, ${tsconfigs.skipped.length} skipped`,
      );
      logger.info(
        `• ESLint : ${eslint.created.length} created, ${eslint.updated.length} updated, ${eslint.skipped.length} skipped`,
      );
      logger.info(
        `• Stubs : ${stubs.created.length} created, ${stubs.updated.length} updated, ${stubs.skipped.length} skipped`,
      );
      logger.info(
        `• Apps : ${appsResult.created.length} created, ${appsResult.updated.length} updated, ${appsResult.skipped.length} skipped`,
      );
      logger.info(`• Total ops : ${totalOps}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync error";
      logger.error(`Sync failed: ${message}`);
      // Attempt total rollback on error (unless dry‑run)
      if (!dryRun) {
        try {
          await execAsync("git reset --hard HEAD && git clean -fd", {
            cwd: this.workspaceRoot,
          });
          logger.info("Rollback completed after failure.");
        } catch (rollbackErr) {
          logger.warn(
            `Rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}`,
          );
        }
        process.exit(1);
      }
    } finally {
      if (lockFile) {
        try {
          await lockFile.release();
        } catch (releaseErr) {
          logger.warn(
            `Lock release failed: ${releaseErr instanceof Error ? releaseErr.message : releaseErr}`,
          );
        }
      }
    }
  }
}
