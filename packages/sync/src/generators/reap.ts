// reap.ts – delete empty legacy layer folders after successful generation
import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";

/**
 * Removes legacy layer directories (domain, application, infrastructure) if they are empty.
 * Accepts an optional report to log deletions.
 */
export async function reapLegacyFolders(
  moduleDir: string,
  config: SyncConfig,
  report?: { record: (type: string, target: string, message?: string) => void },
): Promise<void> {
  const legacyLayers = ["domain", "application", "infrastructure"];
  for (const layer of legacyLayers) {
    const layerPath = path.join(moduleDir, layer);
    try {
      const entries = await fs.readdir(layerPath);
      // If only index.ts exists (or nothing), we consider it safe to delete
      const nonEmpty = entries.filter((e) => e !== "index.ts");
      if (nonEmpty.length === 0) {
        await fs.rm(layerPath, { recursive: true, force: true });
        if (report) report.record("deleted", layerPath);
      }
    } catch (e: any) {
      // ignore if folder does not exist
      if (e.code !== "ENOENT") throw e;
    }
  }
}
