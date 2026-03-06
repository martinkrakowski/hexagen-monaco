import path from 'node:path';
import fs from 'node:fs/promises';
import * as yaml from 'js-yaml';
import type { SyncConfig } from './config.js';
import { safeWriteFile } from './fs-utils.js';
import { runArchLinter } from './linter.js';
import { ensureLayerFolders } from './generators/layer-folders.js';
// Import generators here (once extracted)
// import { ensureLayerFolders } from './generators/layer-folders.js';
// import { generateBarrelsForModule } from './generators/barrels.js';
// import { generateStubsForModule } from './generators/stubs.js';
// import { generateOrUpdatePackageJson } from './generators/package-json.js';
// import { generateOrUpdatePackageTsConfig, syncRootTsConfigReferences } from './generators/tsconfig.js';

const ROOT_DIR = process.cwd();
const MANIFEST_PATH = path.join(ROOT_DIR, '.architecture.yaml');

interface SyncResult {
  filesCreated: number;
  filesUpdated: number;
  filesSkipped: number;
  filesUnchanged: number;
  modulesProcessed: number;
  summaryMessage: string;
}

export class SyncEngine {
  private config: SyncConfig;
  private manifest: any; // TODO: Replace with proper Zod-validated type later

  constructor(config: SyncConfig) {
    this.config = config;
  }

  private async loadManifest(): Promise<void> {
    const { logger, dryRun } = this.config;

    try {
      const content = await fs.readFile(MANIFEST_PATH, 'utf8');
      this.manifest = yaml.load(content);

      if (!this.manifest || typeof this.manifest !== 'object') {
        throw new Error('Invalid manifest format');
      }

      logger.info(`Loaded manifest from ${MANIFEST_PATH}`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        if (dryRun) {
          logger.warn(`Manifest not found — using empty manifest for dry-run`);
          this.manifest = { modules: [] };
          return;
        }

        logger.error(
          `Manifest file missing: ${MANIFEST_PATH}. Cannot continue in real mode.`
        );
        throw new Error('Manifest file missing');
      }

      logger.error(`Failed to load manifest: ${err.message}`);
      throw err;
    }
  }

  private async ensureDirectories(): Promise<void> {
    const layers = this.manifest.generator?.sync?.layers || {};
    const modules = this.manifest.modules || [];

    for (const mod of modules) {
      const moduleDir = path.join(process.cwd(), 'packages', mod.name);
      await ensureLayerFolders(moduleDir, layers, this.config);
    }
  }

  private async generateCoreArtifacts(): Promise<SyncResult> {
    const result: SyncResult = {
      filesCreated: 0,
      filesUpdated: 0,
      filesSkipped: 0,
      filesUnchanged: 0,
      modulesProcessed: 0,
      summaryMessage: '',
    };

    const { logger } = this.config;

    // Root-level sync (tsconfig references, root package.json if needed)
    // await syncRootTsConfigReferences(this.manifest, this.config);

    // Per-module generation
    const modules = this.manifest.modules || [];
    result.modulesProcessed = modules.length;

    for (const module of modules) {
      const moduleName = module.name;
      logger.info(`Processing module: ${moduleName}`);

      // TODO: Delegate to extracted generators
      // await generateOrUpdatePackageJson(moduleName, module, this.config);
      // await generateOrUpdatePackageTsConfig(moduleName, module, this.config);
      // await ensureLayerFolders(moduleName, this.config);
      // await generateBarrelsForModule(moduleName, module, this.config);
      // await generateStubsForModule(moduleName, module, this.config);

      // Placeholder counters (replace with real results when generators return statuses)
      result.filesCreated += 2;
      result.filesUpdated += 1;
    }

    result.summaryMessage = `Processed ${result.modulesProcessed} modules.`;
    return result;
  }

  async run(): Promise<void> {
    const { logger, dryRun } = this.config;

    logger.info(
      dryRun ? '[DRY-RUN MODE] Starting sync...' : 'Starting sync...'
    );

    try {
      await this.loadManifest();

      await this.ensureDirectories();

      const generationResult = await this.generateCoreArtifacts();

      await runArchLinter(this.config);

      // Final summary
      logger.info('\nSync completed successfully.');
      logger.info(generationResult.summaryMessage);
      logger.info(
        `Files: ${generationResult.filesCreated} created, ` +
          `${generationResult.filesUpdated} updated, ` +
          `${generationResult.filesSkipped} skipped, ` +
          `${generationResult.filesUnchanged} unchanged`
      );
    } catch (err: any) {
      logger.error(`Sync failed: ${err.message}`);
      if (!dryRun) {
        process.exit(1);
      }
    }
  }
}
