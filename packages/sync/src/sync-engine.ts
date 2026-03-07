import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { SyncConfig } from './config.js';
import { safeWriteFile } from './fs-utils.js';
import { runArchLinter } from './linter.js';
import { ensureLayerFolders } from './generators/layer-folders.js';
import { generateBarrels } from './generators/barrels.js';
import { generateStubs } from './generators/stubs.js';
import { generatePackageJson } from './generators/package-json.js';
import { generateTsconfig } from './generators/tsconfig.js';
import { createEmptyResult, type GeneratorResult } from './results.js';

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Central orchestrator — ALL generators return structured GeneratorResult.
 */
export class SyncEngine {
  private config: SyncConfig;
  private manifest: any = {};

  constructor(config: SyncConfig) {
    this.config = config;
  }

  private async loadManifest(): Promise<void> {
    const { logger, dryRun } = this.config;

    const manifestPath = path.resolve(__dirname, '../../../.architecture.yaml');

    logger.info(`[debug] __dirname (ESM): ${__dirname}`);
    logger.info(`[debug] resolved manifestPath: ${manifestPath}`);

    try {
      await fs.access(manifestPath);
      logger.info('[debug] fs.access succeeded');
    } catch {}

    try {
      const content = await fs.readFile(manifestPath, 'utf8');
      this.manifest = yaml.load(content);

      logger.info(`Loaded manifest from ${manifestPath}`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        if (dryRun) {
          logger.warn(`Manifest not found — using empty for dry-run`);
          this.manifest = { modules: [] };
          return;
        }
        throw new Error('Manifest file missing');
      }
      throw err;
    }
  }

  private async ensureRootFiles(): Promise<void> {
    const { logger } = this.config;
    const rootFiles = [
      {
        path: path.join(process.cwd(), '.gitignore'),
        content:
          '# HexaGen defaults\nnode_modules\ndist\n.next\n.turbo\n*.log\n.DS_Store\n',
      },
      {
        path: path.join(process.cwd(), 'turbo.json'),
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
      const status = await safeWriteFile(file.path, file.content, this.config);
      if (status !== 'unchanged' && status !== 'skipped') {
        logger.info(`Root file ${status}: ${file.path}`);
      }
    }
  }

  private async ensureDirectories(): Promise<GeneratorResult> {
    const result = createEmptyResult();
    const { logger } = this.config;
    const layers = this.manifest.generator?.sync?.layers || {};
    const modules = this.manifest.bounded_contexts || [];

    for (const mod of modules) {
      if (!mod?.name) continue;
      const moduleDir = path.join(process.cwd(), 'packages', mod.name);
      logger.info(
        `Ensuring directories for module: ${mod.name} at ${moduleDir}`
      );

      const layerResult = await ensureLayerFolders(
        moduleDir,
        layers,
        this.config
      );
      result.created.push(...layerResult.created);
      result.skipped.push(...layerResult.skipped);
      result.updated.push(...layerResult.updated);
      result.dryRunOperations += layerResult.dryRunOperations;
    }
    return result;
  }

  private async generateCoreArtifacts(): Promise<GeneratorResult> {
    const result = createEmptyResult();
    const { logger } = this.config;
    const modules = this.manifest.bounded_contexts || [];

    await this.ensureRootFiles();

    for (const module of modules) {
      const moduleName = module.name;
      const moduleDir = path.join(process.cwd(), 'packages', moduleName);
      logger.info(`Processing module: ${moduleName}`);

      const barrelResult = await generateBarrels(moduleDir, this.config);
      const stubResult = await generateStubs(moduleDir, this.config);
      const pkgResult = await generatePackageJson(
        moduleDir,
        moduleName,
        this.config
      );
      const tsResult = await generateTsconfig(
        moduleDir,
        moduleName,
        this.config
      );

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
    const { logger, dryRun } = this.config;
    const start = Date.now();

    logger.info(
      dryRun ? '[DRY-RUN MODE] Starting sync...' : 'Starting sync...'
    );

    try {
      await this.loadManifest();

      const layerResult = await this.ensureDirectories();
      const artifactsResult = await this.generateCoreArtifacts();

      await runArchLinter(this.config);

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
    } catch (err: any) {
      logger.error(`Sync failed: ${err.message}`);
      if (!dryRun) process.exit(1);
    }
  }
}
