/* eslint-disable no-console */
/**
 * `hexagen manifest migrate` (Wave-C PR-C1, RCA #6) — thin CLI plumbing
 * around MigrateManifestUseCase: read `.architecture/manifest.yaml`, run the
 * registry walk + stamp, report, write back (with a backup, mirroring
 * `manifest split`'s `.pre-split-backup`). All migration semantics — and
 * their tests — live in the use-case.
 *
 * Since H1, it also stamps the generator identity marker (`generator.name`,
 * see stamp-generator-identity.use-case.ts). For a split manifest the marker
 * lives in the side-car named by `workspace_config` (whose `generator`, when
 * present, replaces the root's), otherwise at the root.
 */
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import yaml from "js-yaml";
import { HEXAGEN_GENERATOR_NAME } from "@hexagen/project-configuration";
import { findWorkspaceRoot } from "../../sync-engine-init.js";
import { MigrateManifestUseCase } from "../../application/use-cases/migrate-manifest.use-case.js";
import { StampGeneratorIdentityUseCase } from "../../application/use-cases/stamp-generator-identity.use-case.js";
import { isIndexManifest } from "../../loaders/index.js";

/** Write a file atomically (temp + rename) with a `.pre-migrate-backup` copy. Returns the backup path. */
async function writeWithBackup(
  filePath: string,
  content: string,
): Promise<string> {
  const backupPath = filePath + ".pre-migrate-backup";
  await fs.copyFile(filePath, backupPath);
  const tempPath = filePath + ".tmp";
  try {
    await fs.writeFile(tempPath, content, "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (writeErr) {
    await fs.rm(tempPath, { force: true });
    throw writeErr;
  }
  return backupPath;
}

/**
 * H1 review: the lexical containment check in the command cannot see
 * symlinks, so `.architecture/external -> /tmp/external` would let migrate
 * read, back up and rewrite a file outside the project. Resolve both
 * `.architecture/` and the side-car with realpath and require the canonical
 * side-car to stay inside the canonical `.architecture/` before anything
 * is read, backed up or written. The side-car itself must be a regular
 * file — lstat, so a symlink is refused even when it points back inside —
 * and a side-car that does not exist yet is resolved through its parent
 * directory, so the check still applies to where it would be created.
 */
async function assertSideCarInsideArchitecture(
  archDir: string,
  sideCarPath: string,
  pointer: string,
): Promise<void> {
  const canonicalArchDir = await fs.realpath(archDir);
  const sideCarStat = await fs.lstat(sideCarPath).catch((): null => null);
  if (sideCarStat !== null && !sideCarStat.isFile()) {
    throw new Error(
      `workspace_config side-car is not a regular file: ${pointer}`,
    );
  }
  let canonicalSideCarPath: string;
  if (sideCarStat === null) {
    // Not created yet: canonicalise the parent (when even the parent is
    // missing, the read below would fail — report it the way migrate does).
    const canonicalParent = await fs
      .realpath(path.dirname(sideCarPath))
      .catch((): null => null);
    if (canonicalParent === null) {
      throw new Error(`Workspace config file not found: ${sideCarPath}`);
    }
    canonicalSideCarPath = path.join(
      canonicalParent,
      path.basename(sideCarPath),
    );
  } else {
    canonicalSideCarPath = await fs.realpath(sideCarPath);
  }
  const canonicalRel = path.relative(canonicalArchDir, canonicalSideCarPath);
  if (canonicalRel.startsWith("..") || path.isAbsolute(canonicalRel)) {
    throw new Error(
      `workspace_config points outside .architecture/: ${pointer}`,
    );
  }
}

export const manifestMigrateCommander = new Command("migrate")
  .description(
    "Bring .architecture/manifest.yaml to the current schema version (stamps schemaVersion, applies registered migrations) and add the generator identity marker (generator.name)",
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

      const result = new MigrateManifestUseCase(isDeepStrictEqual).execute(
        content,
      );
      const rootContent = result.content;
      const rootChanged = result.changed;

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

      const root = yaml.load(rootContent) as Record<string, unknown>;
      const workspaceConfigPointer =
        typeof root.workspace_config === "string"
          ? root.workspace_config
          : undefined;

      const archDir = path.join(workspaceRoot, ".architecture");

      type StampTarget = "root" | "side-car" | "none";
      let target: StampTarget;
      let sideCarPath: string | undefined;
      let sideCarRel: string | undefined;
      let sideCarText: string | undefined;

      if (workspaceConfigPointer !== undefined) {
        sideCarPath = path.join(archDir, workspaceConfigPointer);
        const containmentRel = path.relative(archDir, sideCarPath);
        if (
          containmentRel.startsWith("..") ||
          path.isAbsolute(containmentRel)
        ) {
          throw new Error(
            `workspace_config points outside .architecture/: ${workspaceConfigPointer}`,
          );
        }
        // H1 review: the check above is lexical — canonicalise both sides
        // and refuse a side-car that resolves outside .architecture/ (or
        // is itself a symlink) before anything is read, backed up or
        // written.
        await assertSideCarInsideArchitecture(
          archDir,
          sideCarPath,
          workspaceConfigPointer,
        );
        sideCarRel = path.relative(workspaceRoot, sideCarPath);

        try {
          sideCarText = await fs.readFile(sideCarPath, "utf-8");
        } catch {
          throw new Error(`Workspace config file not found: ${sideCarPath}`);
        }

        const sideCarParsed = yaml.load(sideCarText);
        const sideCarHasGenerator =
          sideCarParsed !== null &&
          typeof sideCarParsed === "object" &&
          !Array.isArray(sideCarParsed) &&
          (sideCarParsed as Record<string, unknown>).generator !== undefined;

        const rootHasGenerator = root.generator !== undefined;
        if (sideCarHasGenerator) {
          target = "side-car";
        } else if (rootHasGenerator) {
          target = "root";
        } else {
          target = "side-car";
        }
      } else {
        target = isIndexManifest(root) ? "none" : "root";
      }

      const identityStamp = new StampGeneratorIdentityUseCase(
        isDeepStrictEqual,
      );
      const identityLabel = JSON.stringify(HEXAGEN_GENERATOR_NAME);

      let stampedRoot = rootContent;
      let rootChangedFinal = rootChanged;
      let stampedSideCar: string | undefined;
      let sideCarChanged = false;

      if (target === "none") {
        console.log(
          "Identity : skipped (split manifest has no workspace_config side-car)",
        );
      } else if (target === "root") {
        const stamp = identityStamp.execute(rootContent);
        stampedRoot = stamp.content;
        rootChangedFinal = rootChanged || stamp.changed;
        const rel = path.relative(workspaceRoot, manifestPath);
        if (stamp.changed) {
          console.log(
            `Identity: generator.name ${identityLabel} — added to ${rel}`,
          );
        } else {
          console.log(`Identity: generator.name already present in ${rel}`);
        }
      } else {
        const stamp = identityStamp.execute(sideCarText as string);
        stampedSideCar = stamp.content;
        sideCarChanged = stamp.changed;
        if (stamp.changed) {
          console.log(
            `Identity: generator.name ${identityLabel} — added to ${sideCarRel}`,
          );
        } else {
          console.log(
            `Identity: generator.name already present in ${sideCarRel}`,
          );
        }
      }

      const anyChanged = rootChangedFinal || sideCarChanged;
      if (!anyChanged) {
        console.log(
          "\n✅ Already at the current schema version and generator identity — nothing to do.",
        );
        return;
      }

      if (dryRun) {
        const wouldRewrite: string[] = [];
        if (rootChangedFinal) {
          wouldRewrite.push(path.relative(workspaceRoot, manifestPath));
        }
        if (sideCarChanged) {
          wouldRewrite.push(sideCarRel as string);
        }
        console.log(
          `\n[dry-run] Would rewrite: ${wouldRewrite.join(", ")}. No files written.`,
        );
        return;
      }

      if (sideCarChanged) {
        const backupPath = await writeWithBackup(
          sideCarPath as string,
          stampedSideCar as string,
        );
        console.log(`\nBackup created at ${backupPath}`);
      }
      if (rootChangedFinal) {
        const backupPath = await writeWithBackup(manifestPath, stampedRoot);
        console.log(`\nBackup created at ${backupPath}`);
      }
      console.log("✅ Manifest migrated successfully.");
    } catch (err) {
      console.error(
        `\n❌ Migration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });
