import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyncConfig } from '../config.js';

interface LayerConfig {
  folder: string;
  subfolders?: string[];
}

/**
 * Creates layer folders and any declared subfolders from manifest.generator.sync.layers.
 * Fully data-driven — no hardcoded layer names or subfolders.
 */
export async function ensureLayerFolders(
  moduleDir: string,
  layersConfig: Record<string, LayerConfig> = {},
  config: SyncConfig
): Promise<void> {
  const { logger, dryRun } = config;

  for (const [layerName, cfg] of Object.entries(layersConfig)) {
    const layerPath = path.join(moduleDir, 'src', cfg.folder);

    if (dryRun) {
      logger.info(`[dry-run] Would ensure layer folder: ${layerPath}`);
    } else {
      await fs.mkdir(layerPath, { recursive: true });
      logger.info(`Ensured layer folder: ${layerPath}`);
    }

    if (cfg.subfolders?.length) {
      for (const sub of cfg.subfolders) {
        const subPath = path.join(layerPath, sub);

        if (dryRun) {
          logger.info(`[dry-run] Would ensure subfolder: ${subPath}`);
        } else {
          await fs.mkdir(subPath, { recursive: true });
        }
      }

      if (!dryRun) {
        logger.info(
          `Ensured subfolders in ${layerName}: ${cfg.subfolders.join(', ')}`
        );
      }
    }
  }
}
