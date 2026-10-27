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
 * present, replaces the root's), otherwise at the root. H1 review 2: both
 * files are resolved to canonical paths inside `.architecture/` — and refused
 * when they are not regular files or resolve elsewhere — before anything is
 * read, backed up or written.
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

/** Refusal messages {@link canonicalPathInsideArchitecture} uses for a file. */
type CanonicalPathLabel = {
  /** prefix of the regular-file refusal, e.g. "manifest" */
  kind: string;
  /** prefix of the containment refusal, e.g. "workspace_config" */
  owner: string;
  /** path shown in both refusals, e.g. a pointer or ".architecture/manifest.yaml" */
  display: string;
  /** message thrown when the containing directory cannot be resolved at all */
  notFound: string;
};

/**
 * H1 review: the lexical containment check in the command cannot see
 * symlinks, so `.architecture/external -> /tmp/external` would let migrate
 * read, back up and rewrite a file outside the project. Resolve the target
 * with realpath and require its canonical path to stay inside the
 * project's `.architecture/` before anything is read, backed up or
 * written. The target itself must be a regular file — lstat, so a
 * symlink is refused even when it points back inside — and a target that
 * does not exist yet is resolved through its parent directory, so the
 * check still applies to where it would be created. H1 review 2 folded
 * the root manifest into the same check (it was previously read and
 * rewritten through whatever `.architecture/manifest.yaml` happened to
 * be) and made the returned canonical path the one every later read,
 * backup and write must go through. `.architecture/` itself is
 * canonicalised through the workspace root and kept literal, so a
 * symlinked `.architecture/` resolving anywhere else fails the
 * containment check instead of relocating the project's boundaries.
 */
async function canonicalPathInsideArchitecture(
  archDir: string,
  filePath: string,
  label: CanonicalPathLabel,
): Promise<string> {
  const canonicalArchDir = path.join(
    await fs.realpath(path.dirname(archDir)),
    path.basename(archDir),
  );
  const targetStat = await fs.lstat(filePath).catch((): null => null);
  if (targetStat !== null && !targetStat.isFile()) {
    throw new Error(`${label.kind} is not a regular file: ${label.display}`);
  }
  let canonicalPath: string;
  if (targetStat === null) {
    // Not created yet: canonicalise the parent, so the containment check
    // still applies to where the file would be created (when even the
    // parent is missing, the read below would fail — report it the way
    // migrate does).
    const canonicalParent = await fs
      .realpath(path.dirname(filePath))
      .catch((): null => null);
    if (canonicalParent === null) {
      throw new Error(label.notFound);
    }
    canonicalPath = path.join(canonicalParent, path.basename(filePath));
  } else {
    canonicalPath = await fs.realpath(filePath);
  }
  const canonicalRel = path.relative(canonicalArchDir, canonicalPath);
  if (canonicalRel.startsWith("..") || path.isAbsolute(canonicalRel)) {
    throw new Error(
      `${label.owner} points outside .architecture/: ${label.display}`,
    );
  }
  return canonicalPath;
}

/**
 * Re-run the containment check immediately before a write: the file may
 * have been swapped for a symlink or moved since it was read. Refuse
 * unless it still resolves to the exact canonical path that was
 * validated and read.
 */
async function assertUnchangedSinceRead(
  archDir: string,
  filePath: string,
  label: CanonicalPathLabel,
  canonicalPath: string,
): Promise<void> {
  const revalidated = await canonicalPathInsideArchitecture(
    archDir,
    filePath,
    label,
  );
  if (revalidated !== canonicalPath) {
    throw new Error(
      `${label.owner} changed since it was read: ${label.display}`,
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
      const archDir = path.join(workspaceRoot, ".architecture");
      const manifestPath = path.join(
        workspaceRoot,
        ".architecture/manifest.yaml",
      );

      // H1 review 2: the root manifest gets the same refusal as the
      // side-car — a symlink or non-regular file is refused before it is
      // read, and the canonical path (which must stay inside the
      // project's .architecture/) is the one read, backed up and written.
      const manifestLabel: CanonicalPathLabel = {
        kind: "manifest",
        owner: "manifest",
        display: path.relative(workspaceRoot, manifestPath),
        notFound: `Failed to read ${manifestPath}. Does it exist?`,
      };
      const canonicalManifestPath = await canonicalPathInsideArchitecture(
        archDir,
        manifestPath,
        manifestLabel,
      );

      let content: string;
      try {
        content = await fs.readFile(canonicalManifestPath, "utf-8");
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

      type StampTarget = "root" | "side-car" | "none";
      let target: StampTarget;
      let sideCarPath: string | undefined;
      let sideCarRel: string | undefined;
      let sideCarText: string | undefined;
      let sideCarLabel: CanonicalPathLabel | undefined;
      let canonicalSideCarPath: string | undefined;

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
        // written. H1 review 2: the canonical path it returns is the one
        // every later read, backup and write goes through.
        sideCarLabel = {
          kind: "workspace_config side-car",
          owner: "workspace_config",
          display: workspaceConfigPointer,
          notFound: `Workspace config file not found: ${sideCarPath}`,
        };
        canonicalSideCarPath = await canonicalPathInsideArchitecture(
          archDir,
          sideCarPath,
          sideCarLabel,
        );
        sideCarRel = path.relative(workspaceRoot, canonicalSideCarPath);

        try {
          sideCarText = await fs.readFile(canonicalSideCarPath, "utf-8");
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
        const rel = path.relative(workspaceRoot, canonicalManifestPath);
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
          wouldRewrite.push(
            path.relative(workspaceRoot, canonicalManifestPath),
          );
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
        // Re-validate right before the write: the file may have been
        // swapped for a symlink or moved since it was read.
        await assertUnchangedSinceRead(
          archDir,
          sideCarPath as string,
          sideCarLabel as CanonicalPathLabel,
          canonicalSideCarPath as string,
        );
        const backupPath = await writeWithBackup(
          canonicalSideCarPath as string,
          stampedSideCar as string,
        );
        console.log(`\nBackup created at ${backupPath}`);
      }
      if (rootChangedFinal) {
        await assertUnchangedSinceRead(
          archDir,
          manifestPath,
          manifestLabel,
          canonicalManifestPath,
        );
        const backupPath = await writeWithBackup(
          canonicalManifestPath,
          stampedRoot,
        );
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
