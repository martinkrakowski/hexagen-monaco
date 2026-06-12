import path from "node:path";
import { SyncFlags, SyncConfig } from "./config.js";
import { MigrationReport } from "./migration-report.js";
import { SyncJournal } from "./journal.js";
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
import { generateCrossContext } from "./generators/cross-context.js";
import { generateSharedKernel } from "./generators/shared-kernel.js";
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
  // PR-B1 (RCA #4): per-run mutation journal — pre-images of every file sync
  // touches, replayed in reverse on failure (see journal.ts). The lifetime is
  // one RUN, not one instance: run() re-news it on entry, so a reused engine
  // can never replay a previous run's pre-images into a later rollback.
  private journal = new SyncJournal();
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

    // Fresh journal per run (PR-B1 review): both live callers construct a
    // fresh engine per invocation, but only this reset makes that structural —
    // a second run() on a reused instance would otherwise replay run-1
    // pre-images into run-2's rollback, restoring pre-run-1 state.
    this.journal = new SyncJournal();

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
        journal: this.journal,
      } as const;

      if (!dryRun && mode === "self-regen") {
        lockFile = new LockFile(this.workspaceRoot);
        try {
          await lockFile.acquire();
        } catch (err) {
          // Distinguish lock contention from other errors
          if (
            err instanceof Error &&
            err.message.includes("Sync already in progress")
          ) {
            logger.error("Sync aborted: another sync is in progress");
            throw new Error("Sync aborted: another sync is in progress");
          }
          // Other errors (permission, I/O, etc) should not be masked
          logger.error(
            `Lock acquire failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
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
      // Cross-context transport (Phase 3a): bespoke event-bus ports + adapters +
      // shared contracts. Runs after apps and before the pass-2 barrels (disk-based,
      // so they re-export the emitted files). Sole writer of these files — they are
      // not declared in the manifest layers, so generateStubs cannot clobber them.
      const crossContextResult = await generateCrossContext(
        this.fullConfig,
        this.report,
      );
      // Shared Result kernel (#246): ensure `@{scope}/shared` exports `Result`
      // for the generic use-case stub. Before pass-2 barrels so they re-export it.
      const sharedKernelResult = await generateSharedKernel(
        this.fullConfig,
        this.report,
      );

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
        appsResult.totalOps +
        crossContextResult.totalOps +
        sharedKernelResult.totalOps;

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
        `• CrossContext : ${crossContextResult.created.length} created, ${crossContextResult.updated.length} updated, ${crossContextResult.skipped.length} skipped`,
      );
      logger.info(
        `• SharedKernel : ${sharedKernelResult.created.length} created, ${sharedKernelResult.updated.length} updated, ${sharedKernelResult.skipped.length} skipped`,
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
      // PR-B1 (RCA #4): scoped, journaled rollback. The old handler ran
      // `git reset --hard HEAD && git clean -fd` against the WHOLE workspace
      // root — destroying the user's uncommitted work and every untracked
      // file in the tree (including files sync never touched), in both modes,
      // even under --allow-dirty. The journal replay below restores exactly
      // the files sync mutated, and nothing else, with no git dependency at
      // all (external targets need not be git repositories).
      if (!dryRun) {
        if (this.journal.size === 0) {
          logger.info(
            "No files were touched before the failure — nothing to roll back.",
          );
        } else if (allowDirty) {
          // Never mutate a tree we were told was dirty: the failure may stem
          // from the dirty state itself, and an automated "fix" on top of
          // uncommitted user work compounds unpredictability. Report what was
          // touched and leave the tree as-is (exit ≠0 via the rethrow below).
          logger.warn(
            `Sync failed after touching ${this.journal.size} path(s) — NO rollback under --allow-dirty; the tree is left as-is:`,
          );
          for (const line of this.journal.describeEntries(this.workspaceRoot)) {
            logger.warn(`  ${line}`);
          }
        } else {
          logger.info(
            `Rolling back ${this.journal.size} journaled path(s) (inverse-ops; never git reset/clean)...`,
          );
          const outcome = await this.journal.rollback(
            logger,
            this.workspaceRoot,
          );
          if (outcome.failures.length === 0) {
            logger.info(
              `Rollback completed: ${outcome.restored}/${outcome.attempted} path(s) restored.`,
            );
          } else {
            // Best-effort replay already restored what it could; report the
            // rest path-by-path. Deliberately NOT escalating to a git-wide
            // reset — that is the data-loss class this journal removes.
            for (const f of outcome.failures) {
              logger.error(
                `Rollback failed for ${path.relative(this.workspaceRoot, f.path)}: intended to ${f.intended} — ${f.error}`,
              );
            }
            logger.error(
              `Rollback incomplete: ${outcome.failures.length} of ${outcome.attempted} path(s) NOT restored — inspect the paths above.`,
            );
          }
        }
      }
      // Always rethrow — exit-code decisions belong to the caller (cli.ts sets
      // process.exitCode; the wizard's external-sync-engine adapter maps the
      // throw to a Result). The previous in-engine process.exit(1) skipped the
      // finally-block lock release, killed the host process in external mode,
      // and silently swallowed dry-run failures (exit 0).
      throw err;
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
