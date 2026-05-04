import path from "node:path";
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
import {
  type GeneratorResults,
  mergeResult,
  mergeBarrelPasses,
} from "./sync-engine-helpers.js";
import {
  findWorkspaceRoot,
  loadManifest,
  validateManifest,
  type InitOptions,
} from "./sync-engine-init.js";

const execAsync = promisify(exec);

export interface SyncEngineOptions {
  targetRoot?: string;
  manifest?: Manifest;
}

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

  private getInitOptions(): InitOptions {
    return {
      targetRoot: this.options?.targetRoot,
      manifest: this.options?.manifest,
    };
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

      const barrelResult = await generateBarrels(
        moduleDir,
        config,
        this.report,
      );
      const pkgResult = await generatePackageJson(
        moduleDir,
        moduleName,
        config,
        this.report,
      );
      const tsResult = await generateTsconfig(
        moduleDir,
        moduleName,
        config,
        this.report,
      );
      const eslintResult = await generateEslintConfig(
        moduleDir,
        moduleName,
        config,
        this.report,
      );
      const stubResult = await generateStubs(
        moduleDir,
        moduleName,
        config,
        this.report,
      );

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
      const initOptions = this.getInitOptions();
      this.workspaceRoot = await findWorkspaceRoot(initOptions);
      this.manifest = await loadManifest(
        this.workspaceRoot,
        this.partialConfig,
        initOptions,
      );
      validateManifest(this.manifest, this.partialConfig);

      this.fullConfig = {
        ...this.partialConfig,
        workspaceRoot: this.workspaceRoot,
        manifest: this.manifest,
      } as const;

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

      if (mode === "self-regen") {
        await ensureDependenciesBuilt(this.fullConfig!);
      } else {
        logger.info("Skipping preflight build (external mode)");
      }

      const rootFilesResult = await generateRootFiles(
        this.fullConfig,
        this.report,
      );
      const archFilesResult = await generateArchitectureFiles(
        this.fullConfig,
        this.report,
      );
      const layerResult = await this.ensureDirectories();

      const coreResults = await this.generateCoreArtifacts();
      const { pkgs, tsconfigs, eslint, stubs } = coreResults;
      const firstPassBarrels = coreResults.barrels;
      const appsResult = await generateApps(this.fullConfig, this.report);

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
