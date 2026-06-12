/* eslint-disable no-console */
/**
 * `hexagen manifest migrate` (Wave-C PR-C1, RCA #6) — thin CLI plumbing
 * around MigrateManifestUseCase: read `.architecture/manifest.yaml`, run the
 * registry walk + stamp, report, write back (with a backup, mirroring
 * `manifest split`'s `.pre-split-backup`). All migration semantics — and
 * their tests — live in the use-case.
 */
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { findWorkspaceRoot } from "../../sync-engine-init.js";
import { MigrateManifestUseCase } from "../../application/use-cases/migrate-manifest.use-case.js";

export const manifestMigrateCommander = new Command("migrate")
  .description(
    "Bring .architecture/manifest.yaml to the current schema version (stamps schemaVersion, applies registered migrations)",
  )
  .option("--dry-run", "Preview changes without writing files")
  .action(async (options: { dryRun?: boolean }) => {
    const dryRun = options.dryRun ?? false;

    try {
      const workspaceRoot = await findWorkspaceRoot({});
      const manifestPath = path.join(
        workspaceRoot,
        ".architecture/manifest.yaml",
      );

      let content: string;
      try {
        content = await fs.readFile(manifestPath, "utf-8");
      } catch {
        throw new Error(`Failed to read ${manifestPath}. Does it exist?`);
      }

      const result = new MigrateManifestUseCase().execute(content);

      const from =
        result.fromVersion === undefined
          ? "legacy (no schemaVersion)"
          : `schemaVersion ${result.fromVersion}`;
      console.log(`Manifest: ${manifestPath}`);
      console.log(`From    : ${from}`);
      console.log(`To      : schemaVersion ${result.toVersion}`);
      for (const step of result.applied) {
        console.log(`Applied : ${step}`);
      }

      if (!result.changed) {
        console.log(
          "\n✅ Already at the current schema version — nothing to do.",
        );
        return;
      }

      if (dryRun) {
        console.log(
          "\n[dry-run] Would rewrite the manifest. No files written.",
        );
        return;
      }

      const backupPath = manifestPath + ".pre-migrate-backup";
      await fs.copyFile(manifestPath, backupPath);
      console.log(`\nBackup created at ${backupPath}`);

      await fs.writeFile(manifestPath, result.content, "utf-8");
      console.log("✅ Manifest migrated successfully.");
    } catch (err) {
      console.error(
        `\n❌ Migration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });
