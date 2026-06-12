// reap.ts – delete empty legacy layer folders after successful generation
import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import type { ReportRecorder } from "../domain/types.js";

/**
 * Removes legacy layer directories (domain, application, infrastructure) if they are empty.
 * Accepts an optional report to log deletions.
 *
 * IMPORTANT: Respects dry-run mode — will only log, not delete.
 *
 * NOT journaled (PR-B1): the rmdir below only ever removes directories
 * verified EMPTY (and fails closed with ENOTEMPTY otherwise) — no file
 * content is involved, so there is nothing for the rollback journal to
 * restore (the journal tracks file content, not directory shape).
 */
export async function reapLegacyFolders(
  moduleDir: string,
  config: SyncConfig,
  report?: ReportRecorder,
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
          // rmdir, NOT rm({recursive,force}): it fails closed with ENOTEMPTY,
          // so "reap only ever removes EMPTY directories" is a property of the
          // syscall itself — not just of the readdir guard above — even if the
          // guard drifts or an external writer races the check-then-delete.
          await fs.rmdir(layerPath);
          logger.info(`deleted empty folder ${relativePath}`);
          if (report) report.record("deleted", layerPath);
        }
      }
      // Note: Folders containing only index.ts are now preserved.
      // The sync engine maintains these barrels, so deleting them
      // creates a delete-recreate cycle.
    } catch (e: unknown) {
      if (
        !(
          e instanceof Error &&
          "code" in e &&
          (e as { code?: string }).code === "ENOENT"
        )
      )
        throw e;
    }
  }
}
