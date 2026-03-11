// reap.ts – delete empty legacy layer folders after successful generation
import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";

/**
 * Removes legacy layer directories (domain, application, infrastructure) if they are empty.
 * Accepts an optional report to log deletions.
 *
 * IMPORTANT: Respects dry-run mode — will only log, not delete.
 */
export async function reapLegacyFolders(
  moduleDir: string,
  config: SyncConfig,
  report?: { record: (type: string, target: string, message?: string) => void },
): Promise<void> {
  const { dryRun, logger } = config;
  const legacyLayers = ["domain", "application", "infrastructure"];

  for (const layer of legacyLayers) {
    const layerPath = path.join(moduleDir, layer);
    const relativePath = path.relative(config.workspaceRoot, layerPath);

    try {
      const entries = await fs.readdir(layerPath);

      // Only consider truly empty directories for deletion
      // A folder with just index.ts is NOT empty — it's a valid barrel
      if (entries.length === 0) {
        if (dryRun) {
          logger.info(`[DRY-RUN] would delete empty folder ${relativePath}`);
        } else {
          await fs.rm(layerPath, { recursive: true, force: true });
          logger.info(`deleted empty folder ${relativePath}`);
          if (report) report.record("deleted", layerPath);
        }
      }
      // Note: Folders containing only index.ts are now preserved.
      // The sync engine maintains these barrels, so deleting them
      // creates a delete-recreate cycle.
    } catch (e: any) {
      // ignore if folder does not exist
      if (e.code !== "ENOENT") throw e;
    }
  }
}
