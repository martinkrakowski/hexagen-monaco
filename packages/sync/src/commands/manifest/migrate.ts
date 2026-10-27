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
import { constants as fsConstants } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import yaml from "js-yaml";
import { HEXAGEN_GENERATOR_NAME } from "@hexagen/project-configuration";
import { findWorkspaceRoot } from "../../sync-engine-init.js";
import { MigrateManifestUseCase } from "../../application/use-cases/migrate-manifest.use-case.js";
import { StampGeneratorIdentityUseCase } from "../../application/use-cases/stamp-generator-identity.use-case.js";
import { isIndexManifest } from "../../loaders/index.js";

/**
 * Refuse a sibling path (backup or temp) that exists as anything but a regular
 * file: a planted symlink there would make copyFile or writeFile follow it out of
 * .architecture/ (H1 pre-merge review). A stale regular file is removed so the
 * exclusive create below can proceed.
 */
async function clearSiblingPath(siblingPath: string): Promise<void> {
  const stat = await fs.lstat(siblingPath).catch((): null => null);
  if (stat === null) {
    return;
  }
  if (!stat.isFile()) {
    throw new Error(
      `refusing to write ${path.basename(siblingPath)}: it exists and is not a regular file`,
    );
  }
  await fs.rm(siblingPath);
}

/**
 * Write a file atomically (temp + rename) with a `.pre-migrate-backup` copy. Returns the backup path.
 * Both sibling paths are created exclusively (COPYFILE_EXCL, flag "wx"), which never follows a symlink.
 * A swap between the caller's re-check and this write is still possible in principle; Node exposes no
 * dirfd-relative I/O to close it, so the re-check is the practical limit.
 */
async function writeWithBackup(
  filePath: string,
  content: string,
): Promise<string> {
  const backupPath = filePath + ".pre-migrate-backup";
  const tempPath = filePath + ".tmp";
  await clearSiblingPath(backupPath);
  await clearSiblingPath(tempPath);
  await fs.copyFile(filePath, backupPath, fsConstants.COPYFILE_EXCL);
  try {
    await fs.writeFile(tempPath, content, { encoding: "utf-8", flag: "wx" });
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
      `${label.owner} points outside .architecture/: ${label.display} (.architecture itself must not be a symlink; run migrate in the real directory)`,
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

/** Where the identity marker is stamped (decided by {@link resolveSideCar}). */
type StampTarget = "root" | "side-car" | "none";

/** What {@link loadRootManifest} hands to the later steps. */
interface RootManifestPlan {
  workspaceRoot: string;
  archDir: string;
  manifestPath: string;
  manifestLabel: CanonicalPathLabel;
  canonicalManifestPath: string;
  rootContent: string;
  rootChanged: boolean;
}

/**
 * Read and migrate the root `.architecture/manifest.yaml`: resolve its
 * canonical path inside the project's `.architecture/`, run the schema
 * migrations, and print the migration report.
 */
async function loadRootManifest(
  workspaceRoot: string,
): Promise<RootManifestPlan> {
  const archDir = path.join(workspaceRoot, ".architecture");
  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");

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

  const result = new MigrateManifestUseCase(isDeepStrictEqual).execute(content);

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

  return {
    workspaceRoot,
    archDir,
    manifestPath,
    manifestLabel,
    canonicalManifestPath,
    rootContent: result.content,
    rootChanged: result.changed,
  };
}

/** The side-car half of the stamping decision. */
interface SideCarPlan {
  target: StampTarget;
  sideCarPath: string | undefined;
  sideCarRel: string | undefined;
  sideCarText: string | undefined;
  sideCarLabel: CanonicalPathLabel | undefined;
  canonicalSideCarPath: string | undefined;
}

/** True when the parsed side-car document already has a `generator:` block. */
function hasGeneratorBlock(parsed: unknown): boolean {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).generator !== undefined
  );
}

/**
 * Decide where the identity marker goes: a split manifest names a
 * `workspace_config` side-car, whose `generator` (when present) replaces the
 * root's.
 */
async function resolveSideCar(plan: RootManifestPlan): Promise<SideCarPlan> {
  const root = yaml.load(plan.rootContent) as Record<string, unknown>;
  const workspaceConfigPointer =
    typeof root.workspace_config === "string"
      ? root.workspace_config
      : undefined;

  if (workspaceConfigPointer === undefined) {
    return {
      target: isIndexManifest(root) ? "none" : "root",
      sideCarPath: undefined,
      sideCarRel: undefined,
      sideCarText: undefined,
      sideCarLabel: undefined,
      canonicalSideCarPath: undefined,
    };
  }

  const sideCarPath = path.join(plan.archDir, workspaceConfigPointer);
  const containmentRel = path.relative(plan.archDir, sideCarPath);
  if (containmentRel.startsWith("..") || path.isAbsolute(containmentRel)) {
    throw new Error(
      `workspace_config points outside .architecture/: ${workspaceConfigPointer}`,
    );
  }
  // H1 review: the check above is lexical — canonicalise both sides
  // and refuse a side-car that resolves outside .architecture/ (or
  // is itself a symlink) before anything is read, backed up or
  // written. H1 review 2: the canonical path it returns is the one
  // every later read, backup and write goes through.
  const sideCarLabel: CanonicalPathLabel = {
    kind: "workspace_config side-car",
    owner: "workspace_config",
    display: workspaceConfigPointer,
    notFound: `Workspace config file not found: ${sideCarPath}`,
  };
  const canonicalSideCarPath = await canonicalPathInsideArchitecture(
    plan.archDir,
    sideCarPath,
    sideCarLabel,
  );
  const sideCarRel = path.relative(plan.workspaceRoot, canonicalSideCarPath);

  let sideCarText: string;
  try {
    sideCarText = await fs.readFile(canonicalSideCarPath, "utf-8");
  } catch {
    throw new Error(`Workspace config file not found: ${sideCarPath}`);
  }

  let target: StampTarget;
  if (hasGeneratorBlock(yaml.load(sideCarText))) {
    target = "side-car";
  } else if (root.generator !== undefined) {
    target = "root";
  } else {
    target = "side-car";
  }

  return {
    target,
    sideCarPath,
    sideCarRel,
    sideCarText,
    sideCarLabel,
    canonicalSideCarPath,
  };
}

/** What {@link stampIdentity} decided to write (and whether). */
interface IdentityPlan {
  stampedRoot: string;
  rootChangedFinal: boolean;
  stampedSideCar: string | undefined;
  sideCarChanged: boolean;
}

/**
 * Stamp `generator.name` on the target {@link resolveSideCar} picked and
 * report what was done. No file is written here.
 */
function stampIdentity(
  plan: RootManifestPlan,
  sideCar: SideCarPlan,
): IdentityPlan {
  const identityStamp = new StampGeneratorIdentityUseCase(isDeepStrictEqual);
  const identityLabel = JSON.stringify(HEXAGEN_GENERATOR_NAME);

  if (sideCar.target === "none") {
    console.log(
      "Identity : skipped (split manifest has no workspace_config side-car)",
    );
    return {
      stampedRoot: plan.rootContent,
      rootChangedFinal: plan.rootChanged,
      stampedSideCar: undefined,
      sideCarChanged: false,
    };
  }

  if (sideCar.target === "root") {
    const stamp = identityStamp.execute(plan.rootContent);
    const rel = path.relative(plan.workspaceRoot, plan.canonicalManifestPath);
    if (stamp.changed) {
      console.log(
        `Identity: generator.name ${identityLabel} — added to ${rel}`,
      );
    } else {
      console.log(`Identity: generator.name already present in ${rel}`);
    }
    return {
      stampedRoot: stamp.content,
      rootChangedFinal: plan.rootChanged || stamp.changed,
      stampedSideCar: undefined,
      sideCarChanged: false,
    };
  }

  const stamp = identityStamp.execute(sideCar.sideCarText as string);
  if (stamp.changed) {
    console.log(
      `Identity: generator.name ${identityLabel} — added to ${sideCar.sideCarRel}`,
    );
  } else {
    console.log(
      `Identity: generator.name already present in ${sideCar.sideCarRel}`,
    );
  }
  return {
    stampedRoot: plan.rootContent,
    rootChangedFinal: plan.rootChanged,
    stampedSideCar: stamp.content,
    sideCarChanged: stamp.changed,
  };
}

/** Print the dry-run report: what would be rewritten; nothing is written. */
function printDryRun(
  plan: RootManifestPlan,
  sideCar: SideCarPlan,
  identity: IdentityPlan,
): void {
  const wouldRewrite: string[] = [];
  if (identity.rootChangedFinal) {
    wouldRewrite.push(
      path.relative(plan.workspaceRoot, plan.canonicalManifestPath),
    );
  }
  if (identity.sideCarChanged) {
    wouldRewrite.push(sideCar.sideCarRel as string);
  }
  console.log(
    `\n[dry-run] Would rewrite: ${wouldRewrite.join(", ")}. No files written.`,
  );
}

/**
 * Write the stamped files with backups, re-validating each target's
 * canonical path immediately before its write.
 */
async function writeChanges(
  plan: RootManifestPlan,
  sideCar: SideCarPlan,
  identity: IdentityPlan,
): Promise<void> {
  if (identity.sideCarChanged) {
    // Re-validate right before the write: the file may have been
    // swapped for a symlink or moved since it was read.
    await assertUnchangedSinceRead(
      plan.archDir,
      sideCar.sideCarPath as string,
      sideCar.sideCarLabel as CanonicalPathLabel,
      sideCar.canonicalSideCarPath as string,
    );
    const backupPath = await writeWithBackup(
      sideCar.canonicalSideCarPath as string,
      identity.stampedSideCar as string,
    );
    console.log(`\nBackup created at ${backupPath}`);
  }
  if (identity.rootChangedFinal) {
    await assertUnchangedSinceRead(
      plan.archDir,
      plan.manifestPath,
      plan.manifestLabel,
      plan.canonicalManifestPath,
    );
    const backupPath = await writeWithBackup(
      plan.canonicalManifestPath,
      identity.stampedRoot,
    );
    console.log(`\nBackup created at ${backupPath}`);
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
      const plan = await loadRootManifest(workspaceRoot);
      const sideCar = await resolveSideCar(plan);
      const identity = stampIdentity(plan, sideCar);

      const anyChanged = identity.rootChangedFinal || identity.sideCarChanged;
      if (!anyChanged) {
        console.log(
          "\n✅ Already at the current schema version and generator identity — nothing to do.",
        );
        return;
      }

      if (dryRun) {
        printDryRun(plan, sideCar, identity);
        return;
      }

      await writeChanges(plan, sideCar, identity);
      console.log("✅ Manifest migrated successfully.");
    } catch (err) {
      console.error(
        `\n❌ Migration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });
