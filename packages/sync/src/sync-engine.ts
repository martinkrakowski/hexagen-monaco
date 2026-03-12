import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { SyncFlags, SyncConfig } from "./config.js";
import { MigrationReport } from "./migration-report.js";

import { runArchLinter } from "./linter.js";
import { ensureLayerFolders } from "./generators/layer-folders.js";
import { generateBarrels } from "./generators/barrels.js";
import { generateStubs } from "./generators/stubs.js";
import { generatePackageJson } from "./generators/package-json.js";
import { generateTsconfig } from "./generators/tsconfig.js";
import { reapLegacyFolders } from "./generators/reap.js";
import { createEmptyResult, type GeneratorResult } from "./results.js";
import type { Manifest } from "./types/manifest.js";
import { ensureDependenciesBuilt } from "./preflight.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// Structured return type from generateCoreArtifacts
interface GeneratorResults {
  barrels: GeneratorResult;
  stubs: GeneratorResult;
  pkgs: GeneratorResult;
  tsconfigs: GeneratorResult;
  totalOps: number;
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

  constructor(flags: SyncFlags, options?: SyncEngineOptions) {
    this.partialConfig = flags;
    this.options = options;
  }

  private readonly options?: SyncEngineOptions;

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
    logger.info(`[debug] __dirname (ESM): ${__dirname}`);
    logger.info(`[debug] resolved workspaceRoot: ${this.workspaceRoot}`);
    logger.info(`[debug] resolved manifestPath: ${manifestPath}`);

    try {
      await fs.access(manifestPath);
      logger.info("[debug] fs.access succeeded");
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

  private async generateCoreArtifacts(): Promise<GeneratorResults> {
    const config = this.getConfig();
    const { logger } = config;
    const modules = config.manifest.bounded_contexts ?? [];

    let totalOps = 0;
    const barrels = createEmptyResult();
    const stubs = createEmptyResult();
    const pkgs = createEmptyResult();
    const tsconfigs = createEmptyResult();

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

      const barrelResult = await generateBarrels(
        moduleDir,
        config,
        this.report,
      );
      const stubResult = await generateStubs(moduleDir, config, this.report);
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
      // Reap legacy layer folders after successful generation for this module
      await reapLegacyFolders(moduleDir, config, this.report);

      barrels.created.push(...barrelResult.created);
      barrels.skipped.push(...barrelResult.skipped);
      barrels.updated.push(...barrelResult.updated);
      totalOps += barrelResult.totalOps;

      stubs.created.push(...stubResult.created);
      stubs.skipped.push(...stubResult.skipped);
      stubs.updated.push(...stubResult.updated);
      totalOps += stubResult.totalOps;

      pkgs.created.push(...pkgResult.created);
      pkgs.skipped.push(...pkgResult.skipped);
      pkgs.updated.push(...pkgResult.updated);
      totalOps += pkgResult.totalOps;

      tsconfigs.created.push(...tsResult.created);
      tsconfigs.skipped.push(...tsResult.skipped);
      tsconfigs.updated.push(...tsResult.updated);
      totalOps += tsResult.totalOps;
    }

    return {
      barrels,
      stubs,
      pkgs,
      tsconfigs,
      totalOps,
    };
  }

  async run(): Promise<void> {
    const { logger, dryRun, allowDirty, mode } = this.partialConfig;
    const start = Date.now();

    logger.info(
      dryRun ? "[DRY-RUN MODE] Starting sync..." : "Starting sync...",
    );

    // Ensure a clean git tree before mutating anything (unless --allow-dirty or external mode)
    if (mode === "self-regen" && !allowDirty) {
      const { stdout: gitStatus } = await execAsync("git status --porcelain");
      if (gitStatus && gitStatus.trim().length > 0) {
        logger.error(
          "Git working tree is dirty. Commit or stash changes, or use --allow-dirty to proceed.",
        );
        throw new Error("Dirty git tree");
      }
    } else if (mode === "external") {
      logger.info("Skipping git check (external mode)");
    } else {
      logger.warn("Skipping git clean check (--allow-dirty)");
    }

    try {
      this.workspaceRoot = await this.findWorkspaceRoot();
      await this.loadManifest();

      this.fullConfig = {
        ...this.partialConfig,
        workspaceRoot: this.workspaceRoot,
        manifest: this.manifest,
      } as const;

      // Pre‑flight: build any stale packages
      await ensureDependenciesBuilt(this.fullConfig!);

      const layerResult = await this.ensureDirectories();
      const { barrels, stubs, pkgs, tsconfigs, totalOps } =
        await this.generateCoreArtifacts();

      await runArchLinter(this.fullConfig);
      await this.report.writeReport(this.fullConfig!);

      const duration = Date.now() - start;

      logger.info("\nSync completed successfully.");
      logger.info(
        `Processed ${this.manifest.bounded_contexts?.length ?? 0} modules in ${duration}ms`,
      );
      logger.info(`\n=== Generator Summary ===`);
      logger.info(
        `• Layers : ${layerResult.created.length} created, ${layerResult.updated.length} updated, ${layerResult.skipped.length} skipped`,
      );
      logger.info(
        `• Barrels : ${barrels.created.length} created, ${barrels.updated.length} updated, ${barrels.skipped.length} skipped`,
      );
      logger.info(
        `• Stubs : ${stubs.created.length} created, ${stubs.updated.length} updated, ${stubs.skipped.length} skipped`,
      );
      logger.info(
        `• package.json : ${pkgs.created.length} created, ${pkgs.updated.length} updated, ${pkgs.skipped.length} skipped`,
      );
      logger.info(
        `• tsconfig.json : ${tsconfigs.created.length} created, ${tsconfigs.updated.length} updated, ${tsconfigs.skipped.length} skipped`,
      );
      logger.info(`• Total ops : ${totalOps}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync error";
      logger.error(`Sync failed: ${message}`);
      // Attempt total rollback on error (unless dry‑run)
      if (!dryRun) {
        try {
          await execAsync("git reset --hard HEAD && git clean -fd");
          logger.info("Rollback completed after failure.");
        } catch (rollbackErr) {
          logger.warn(
            `Rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}`,
          );
        }
        process.exit(1);
      }
    }
  }
}
