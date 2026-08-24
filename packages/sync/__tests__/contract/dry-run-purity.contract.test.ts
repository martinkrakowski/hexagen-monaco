/**
 * Dry-run purity contract — `sync --dry-run` must leave the target tree
 * byte-identical (plan: docs/planning/sync-toolchain-development-plan.md,
 * PR-A2, RCA #3).
 *
 * The campaign-foundry incident: a --dry-run unlinked legacy empty barrels,
 * mkdir'd layer folders, and wrote SYNC-MIGRATION-REPORT.md. These tests spawn
 * the BUILT dist/cli.js in the published consumer layout (see
 * ../helpers/published-layout.ts) against a git-committed fixture and assert
 * purity two ways, because each check has a blind spot:
 *
 *   - `git status --porcelain` — catches file content changes, deletions, and
 *     new files, but CANNOT see empty directories (git tracks only files).
 *   - a directory-tree snapshot (dirs + file hashes) — catches the empty
 *     directories the pre-A2 mkdirs created.
 *
 * The fixture arms every mutation path this self-regen run can reach, so the
 * asserts prove the gates, not an idle run:
 *   - a `export {};` barrel in a NON-layer dir with zero sibling sources →
 *     queued for unlink (the exact campaign-foundry shape);
 *   - manifest `generator.sync.layers` with subfolders + a context whose
 *     layer dirs are missing → the layer-folder mkdirs + stub/barrel planning;
 *   - self-regen mode → the migration-report write path runs.
 *
 * NOT armed here (review #315): the shared-kernel mkdir (generateSharedKernel
 * early-returns unless mode === "external" — and the report path above only
 * runs in self-regen, so one fixture cannot arm both) and the apps ×2 /
 * cross-context ×3 mkdirs (PURITY_MANIFEST has no apps or cross-context
 * relationships). Those gates share the exact `if (!config.dryRun)` shape of
 * the armed ones; this suite pins the incident's reachable surface, and the
 * differential run against the pre-A2 dist is the evidence the gates were the
 * only change.
 *
 * Output asserts (`would delete empty barrel`, `would create`) pin that the
 * engine actually PLANNED those mutations; without them an engine that
 * silently skipped generators would pass the purity checks trivially.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type ContractFixture,
  createPublishedLayoutFixture,
  runProcess,
  runHexagen,
  describeResult,
  cleanupFixture,
  assertBuiltArtifactsPresent,
} from "../helpers/published-layout.js";
import { pathExists } from "../helpers/fs-helpers.js";

// generator.sync.layers (subfolders included) arms the layer-folder mkdir
// paths; the shared-kernel context arms the kernel mkdir; billing's layers
// arm pkgs/tsconfigs/stubs planning. Mirrors fixture-factory's LAYERS_TEMPLATE.
const PURITY_MANIFEST = `system: acme-app
scope: acme
architecture: modular-monolith
generator:
  sync:
    layers:
      domain:
        folder: src/domain
      application:
        folder: src/application
        subfolders:
          - ports/in
          - ports/out
          - use-cases
      infrastructure:
        folder: src/infrastructure
        subfolders:
          - adapters
bounded_contexts:
  - name: shared
    type: shared-kernel
    description: Shared primitives
    layers:
      domain: {}
  - name: billing
    type: core
    description: Billing context
    layers:
      domain: {}
      application: {}
`;

async function runGitOrThrow(args: string[], cwd: string): Promise<string> {
  const r = await runProcess("git", args, cwd);
  assert.equal(
    r.code,
    0,
    `git ${args.join(" ")} failed:\n${describeResult(r)}`,
  );
  return r.stdout;
}

/**
 * Commit the whole fixture as the purity baseline. node_modules is ignored:
 * it holds the copied dist + symlinks into the host repo — not a sync target,
 * and committing it would be slow and noisy.
 */
async function gitBaseline(root: string): Promise<void> {
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
  await runGitOrThrow(["init", "-q"], root);
  await runGitOrThrow(["add", "-A"], root);
  // -c identity flags: CI runners have no global git user configured.
  await runGitOrThrow(
    [
      "-c",
      "user.email=contract@test.invalid",
      "-c",
      "user.name=Contract Test",
      "commit",
      "-q",
      "-m",
      "fixture baseline",
    ],
    root,
  );
}

/**
 * Directory-aware snapshot: every directory (trailing slash) and every file
 * (with content hash), sorted. Unlike git porcelain — and unlike
 * fixture-factory's files-only snapshotTree — this catches CREATED EMPTY
 * DIRECTORIES, which is exactly what the pre-A2 ungated mkdirs left behind.
 */
async function snapshotTreeWithDirs(root: string): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git"]);

  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(`${relPath}/`);
        await walk(absPath, relPath);
      } else if (entry.isFile()) {
        const hash = crypto
          .createHash("sha256")
          .update(await fs.readFile(absPath))
          .digest("hex");
        out.push(`${relPath} sha256:${hash}`);
      } else {
        out.push(`${relPath} (symlink)`);
      }
    }
  }

  await walk(root, "");
  return out.sort();
}

/** Seed the campaign-foundry shape: legacy empty barrel in a non-layer dir. */
async function seedLegacyEmptyBarrel(fix: ContractFixture): Promise<string> {
  const legacyRel = path.join(
    "packages",
    "billing",
    "src",
    "domain",
    "legacy",
    "index.ts",
  );
  await fs.mkdir(path.join(fix.root, path.dirname(legacyRel)), {
    recursive: true,
  });
  // `export {};` with no sibling sources → isEmptyStub + zero exports in a
  // non-layer dir → walkDirectory queues it for deletion (recursive.ts).
  await fs.writeFile(path.join(fix.root, legacyRel), "export {};\n", "utf8");
  // The engine logs the barrel under the REALPATH of the fixture root: the
  // ESM loader realpaths import.meta.url, so findWorkspaceRoot resolves
  // /private/var/… while mkdtemp reports /var/… on macOS (same trap as the
  // capstone's issue-#179 guard).
  return path.join(await fs.realpath(fix.root), legacyRel);
}

describe("dry-run purity contract — built dist in published layout", () => {
  beforeAll(assertBuiltArtifactsPresent);

  it("sync --dry-run leaves the tree byte-identical (incl. empty dirs) and writes no report", async () => {
    const fix = await createPublishedLayoutFixture(
      PURITY_MANIFEST,
      "hexagen-dryrun-purity-",
    );
    try {
      const legacyBarrel = await seedLegacyEmptyBarrel(fix);
      await gitBaseline(fix.root);
      const before = await snapshotTreeWithDirs(fix.root);

      const r = await runHexagen(fix, ["sync", "--dry-run", "--allow-dirty"]);
      assert.equal(r.code, 0, describeResult(r));

      // Purity check 1: porcelain (content changes, deletions, new files).
      // Checked before the arming asserts below so a purity REGRESSION
      // surfaces as the actual tree diff, not a missing log line.
      const status = await runGitOrThrow(["status", "--porcelain"], fix.root);
      assert.equal(
        status.trim(),
        "",
        `dry-run dirtied the tree:\n${status}\n${describeResult(r)}`,
      );

      // Purity check 2: tree snapshot (empty dirs are porcelain-invisible).
      const after = await snapshotTreeWithDirs(fix.root);
      assert.deepEqual(
        after,
        before,
        "dry-run changed the directory tree (created/removed entries)",
      );

      assert.equal(
        await pathExists(path.join(fix.root, "SYNC-MIGRATION-REPORT.md")),
        false,
        "dry-run must not write SYNC-MIGRATION-REPORT.md",
      );

      // Prove the run ARMED the gated paths (see header) — a run that
      // planned nothing would pass the purity asserts without testing them.
      // Both sides normalised: legacyBarrel comes from path.join and the CLI
      // prints path.relative output, so on win32 both are backslashed while
      // this file's other literals are not. The claim is WHICH barrel was
      // named, not its spelling.
      const posix = (v: string) => v.replace(/\\/g, "/");
      assert.ok(
        posix(r.stdout).includes(
          `[DRY-RUN] would delete empty barrel ${posix(legacyBarrel)}`,
        ),
        `expected the legacy-barrel deletion intent in output\n${describeResult(r)}`,
      );
      assert.ok(
        r.stdout.includes("[DRY-RUN] would create"),
        `expected planned creations in output\n${describeResult(r)}`,
      );
      assert.ok(
        r.stdout.includes("skipping migration report file"),
        `expected the report-suppression notice in output\n${describeResult(r)}`,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("sync --dry-run --report <path> writes ONLY the opted-in report", async () => {
    const fix = await createPublishedLayoutFixture(
      PURITY_MANIFEST,
      "hexagen-dryrun-report-",
    );
    try {
      await gitBaseline(fix.root);

      const r = await runHexagen(fix, [
        "sync",
        "--dry-run",
        "--allow-dirty",
        "--report",
        "preview-report.md",
      ]);
      assert.equal(r.code, 0, describeResult(r));

      const reportPath = path.join(fix.root, "preview-report.md");
      assert.ok(
        await pathExists(reportPath),
        `--report must opt into writing under dry-run\n${describeResult(r)}`,
      );
      const content = await fs.readFile(reportPath, "utf8");
      assert.ok(
        content.includes("# Sync Migration Report"),
        `unexpected report content:\n${content.slice(0, 300)}`,
      );

      // The default-named report must still be absent…
      assert.equal(
        await pathExists(path.join(fix.root, "SYNC-MIGRATION-REPORT.md")),
        false,
        "--report must redirect, not duplicate, the report",
      );
      // …and the opted-in report must be the ONLY change to the tree.
      const status = await runGitOrThrow(["status", "--porcelain"], fix.root);
      assert.equal(
        status.trim(),
        "?? preview-report.md",
        `expected the opt-in report to be the only tree change:\n${status}`,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("sync --dry-run --report <nested/path> creates the parent dirs and writes the report", async () => {
    const fix = await createPublishedLayoutFixture(
      PURITY_MANIFEST,
      "hexagen-dryrun-nested-report-",
    );
    try {
      await gitBaseline(fix.root);

      // Nested destination: writeReport must mkdir the parent (review #315
      // finding — createWriteStream does not create directories; pre-fix
      // this aborted the run with a stream ENOENT under A1's honest exits).
      const r = await runHexagen(fix, [
        "sync",
        "--dry-run",
        "--allow-dirty",
        "--report",
        "reports/nested/preview.md",
      ]);
      assert.equal(r.code, 0, describeResult(r));

      const reportPath = path.join(fix.root, "reports", "nested", "preview.md");
      assert.ok(
        await pathExists(reportPath),
        `nested --report destination must be created\n${describeResult(r)}`,
      );
      // The opted-in report (with its parent dirs — git collapses untracked
      // dirs to the topmost entry) must be the ONLY change to the tree.
      const status = await runGitOrThrow(["status", "--porcelain"], fix.root);
      assert.equal(
        status.trim(),
        "?? reports/",
        `expected only the nested report dir as a tree change:\n${status}`,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });
});
