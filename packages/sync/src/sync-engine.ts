import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { SyncFlags, SyncConfig } from './config.js';
import { safeWriteFile } from './fs-utils.js';
import { runArchLinter } from './linter.js';
import { ensureLayerFolders } from './generators/layer-folders.js';
import { generateBarrels } from './generators/barrels.js';
import { generateStubs } from './generators/stubs.js';
import { generatePackageJson } from './generators/package-json.js';
import { generateTsconfig } from './generators/tsconfig.js';
import { createEmptyResult, type GeneratorResult } from './results.js';
import type { Manifest } from './types/manifest.js';

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Central orchestrator — ALL generators return structured GeneratorResult.
 */
export class SyncEngine {
  private partialConfig: SyncFlags;
  private fullConfig: SyncConfig | null = null;
  private manifest: Manifest = {};
  private workspaceRoot: string = '';

  constructor(flags: SyncFlags) {
    this.partialConfig = flags;
  }

  private async findWorkspaceRoot(): Promise<string> {
    let currentDir = __dirname;

    while (currentDir !== path.parse(currentDir).root) {
      try {
        const pkgPath = path.join(currentDir, 'package.json');
        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
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
      'Could not locate monorepo root. No package.json with "workspaces" field found.'
    );
  }

  private async loadManifest(): Promise<void> {
    const { logger, dryRun } = this.partialConfig;

    const manifestPath = path.join(this.workspaceRoot, '.architecture.yaml');

    logger.info(`[debug] __dirname (ESM): ${__dirname}`);
    logger.info(`[debug] resolved workspaceRoot: ${this.workspaceRoot}`);
    logger.info(`[debug] resolved manifestPath: ${manifestPath}`);

    try {
      await fs.access(manifestPath);
      logger.info('[debug] fs.access succeeded');
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        err.code === 'ENOENT' &&
        dryRun
      ) {
        logger.warn(`Manifest not found — using empty for dry-run`);
        this.manifest = { bounded_contexts: [] };
        return;
      }
      throw err;
    }

    try {
      const content = await fs.readFile(manifestPath, 'utf8');
      const loaded = yaml.load(content);
      this.manifest = (loaded as Manifest) ?? {};
      logger.info(`Loaded manifest from ${manifestPath}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown parse error';
      throw new Error(`Failed to parse manifest: ${message}`);
    }
  }

  private getConfig(): SyncConfig {
    if (!this.fullConfig) {
      throw new Error('SyncEngine config not initialized. Call run() first.');
    }
    return this.fullConfig;
  }

  private async ensureRootFiles(): Promise<void> {
    const config = this.getConfig();
    const { logger } = config;

    const rootFiles = [
      {
        path: path.join(this.workspaceRoot, '.gitignore'),
        content:
          '# HexaGen defaults\nnode_modules\ndist\n.next\n.turbo\n*.log\n.DS_Store\n',
      },
      {
        path: path.join(this.workspaceRoot, 'turbo.json'),
        content:
          JSON.stringify(
            {
              $schema: 'https://turbo.build/schema.json',
              pipeline: {
                build: { dependsOn: ['^build'] },
                dev: { cache: false, persistent: true },
              },
            },
            null,
            2
          ) + '\n',
      },
    ];

    for (const file of rootFiles) {
      const status = await safeWriteFile(file.path, file.content, config);
      if (status !== 'unchanged' && status !== 'skipped') {
        logger.info(`Root file ${status}: ${file.path}`);
      }
    }
  }

  private async ensureDirectories(): Promise<GeneratorResult> {
    const config = this.getConfig();
    const result = createEmptyResult();
    const { logger } = config;
    const layers = config.manifest.generator?.sync?.layers ?? {};
    const modules = config.manifest.bounded_contexts ?? [];

    for (const mod of modules) {
      if (!mod?.name) continue;
      const moduleDir = path.join(this.workspaceRoot, 'packages', mod.name);
      logger.info(
        `Ensuring directories for module: ${mod.name} at ${moduleDir}`
      );

      const layerResult = await ensureLayerFolders(moduleDir, layers, config);
      result.created.push(...layerResult.created);
      result.skipped.push(...layerResult.skipped);
      result.updated.push(...layerResult.updated);
      result.dryRunOperations += layerResult.dryRunOperations;
    }
    return result;
  }

  private async generateCoreArtifacts(): Promise<GeneratorResult> {
    const config = this.getConfig();
    const result = createEmptyResult();
    const { logger } = config;
    const modules = config.manifest.bounded_contexts ?? [];

    await this.ensureRootFiles();

    for (const module of modules) {
      const moduleName = module.name;
      const moduleDir = path.join(this.workspaceRoot, 'packages', moduleName);
      logger.info(`Processing module: ${moduleName}`);

      const barrelResult = await generateBarrels(moduleDir, config);
      const stubResult = await generateStubs(moduleDir, config);
      const pkgResult = await generatePackageJson(
        moduleDir,
        moduleName,
        config
      );
      const tsResult = await generateTsconfig(moduleDir, moduleName, config);

      result.created.push(
        ...barrelResult.created,
        ...stubResult.created,
        ...pkgResult.created,
        ...tsResult.created
      );
      result.skipped.push(
        ...barrelResult.skipped,
        ...stubResult.skipped,
        ...pkgResult.skipped,
        ...tsResult.skipped
      );
      result.updated.push(
        ...barrelResult.updated,
        ...stubResult.updated,
        ...pkgResult.updated,
        ...tsResult.updated
      );
      result.dryRunOperations +=
        barrelResult.dryRunOperations +
        stubResult.dryRunOperations +
        pkgResult.dryRunOperations +
        tsResult.dryRunOperations;
    }
    return result;
  }

  async run(): Promise<void> {
    const { logger, dryRun } = this.partialConfig;

    const start = Date.now();

    logger.info(
      dryRun ? '[DRY-RUN MODE] Starting sync...' : 'Starting sync...'
    );

    try {
      this.workspaceRoot = await this.findWorkspaceRoot();
      await this.loadManifest();

      this.fullConfig = {
        ...this.partialConfig,
        workspaceRoot: this.workspaceRoot,
        manifest: this.manifest,
      } as const;

      const layerResult = await this.ensureDirectories();
      const artifactsResult = await this.generateCoreArtifacts();

      await runArchLinter(this.fullConfig);

      const duration = Date.now() - start;

      logger.info('\nSync completed successfully.');
      logger.info(
        `Processed ${this.manifest.bounded_contexts?.length ?? 0} modules in ${duration}ms`
      );
      logger.info(`\n=== Generator Summary ===`);
      logger.info(
        `• Layers        : ${layerResult.created.length} created, ${layerResult.skipped.length} skipped`
      );
      logger.info(
        `• Barrels       : ${artifactsResult.created.length} created, ${artifactsResult.skipped.length} skipped`
      );
      logger.info(
        `• Stubs         : ${artifactsResult.created.length} created, ${artifactsResult.skipped.length} skipped`
      );
      logger.info(
        `• package.json  : ${artifactsResult.created.length} created, ${artifactsResult.skipped.length} skipped`
      );
      logger.info(
        `• tsconfig.json : ${artifactsResult.created.length} created, ${artifactsResult.skipped.length} skipped`
      );
      logger.info(
        `• Total ops     : ${layerResult.dryRunOperations + artifactsResult.dryRunOperations}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown sync error';
      logger.error(`Sync failed: ${message}`);
      if (!dryRun) process.exit(1);
    }
  }
}
