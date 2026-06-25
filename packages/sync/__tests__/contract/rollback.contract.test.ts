/**
 * Rollback contract suite — runs the BUILT dist the way a consumer does
 * (plan: docs/planning/sync-toolchain-development-plan.md, PR-B1, RCA #4).
 *
 * Pre-B1 the engine reacted to ANY non-dry-run failure with
 * `git reset --hard HEAD && git clean -fd` against the WHOLE workspace — in
 * both modes, even under --allow-dirty. `clean -fd` deletes every untracked
 * file, including files sync never touched; `reset --hard` discards the
 * user's uncommitted work. Case A below is the sharp differential: on the
 * pre-B1 dist the seeded untracked scratch file is DELETED by the failed
 * run; on the B1 dist it survives byte-identically and the journal of
 * touched paths is printed instead.
 *
 * Failure injection: `packages/beta/package.json` is a committed DIRECTORY,
 * so generatePackageJson's pre-read throws EISDIR deterministically — after
 * alpha's artifacts have all landed (modules are processed sequentially in
 * manifest order), so the journal is non-empty.
 *
 * Second differential (PR-B1 review, proven by mutation test): the fixture
 * also commits a STALE alpha/package.json, so the journal carries an UPDATE
 * entry with a real pre-image, not just creates. Case B asserts the restore
 * is byte-identical to the seed. Without this, regressing the
 * safeWriteFileAtomic hook to `recordWrite(filePath, null)` — which makes
 * rollback DELETE the user's file instead of restoring it — passed every
 * suite, because create→unlink arcs and porcelain-clean checks cannot
 * distinguish "restored pre-image" from "never had a pre-image". Self-regen real runs exec
 * `npx turbo run build` (preflight) with cwd=workspaceRoot; npx resolves the
 * local node_modules/.bin first, so a stub `turbo` keeps the run offline.
 *
 * Both cases start with a dry-run canary (pattern from the exit-codes
 * suite): the same EISDIR pre-read fires in dry-run too, so a non-zero
 * dry-run proves findWorkspaceRoot resolved the FIXTURE. If it ever
 * resolved the host repo (symlinked dist, walk-up change), the dry-run
 * would exit 0 against the host's valid manifest — abort before the real
 * sync below can mutate the host.
 *
 * Fixture layout rationale and process plumbing live in
 * ../helpers/published-layout.ts. POSIX-only (shell shims), like the other
 * contract suites.
 */
import assert from "node:assert/strict";
import { describe, it, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SKIP_NON_POSIX,
  createPublishedLayoutFixture,
  runHexagen,
  describeResult,
  cleanupFixture,
  assertBuiltArtifactsPresent,
  type ContractFixture,
} from "../helpers/published-layout.js";
import { pathExists } from "../helpers/fs-helpers.js";

const FIXTURE_PREFIX = "hexagen-rollback-contract-";

// Stale-but-parseable seed for alpha's COMMITTED package.json — see header.
// generatePackageJson merges (protected keys kept, missing keys injected) and
// overwrites via safeWriteFileAtomic(skipGeneratedCheck), journaling these
// exact bytes as the pre-image.
const STALE_ALPHA_PKG =
  '{\n  "name": "@acme/alpha",\n  "version": "0.0.1"\n}\n';

// alpha generates fully; beta's committed package.json DIRECTORY then makes
// generatePackageJson's pre-read throw EISDIR mid-run.
const ROLLBACK_MANIFEST = `system: acme-app
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: alpha
    type: core
    description: Alpha context (fully generated before beta fails)
    layers:
      domain: {}
  - name: beta
    type: core
    description: Beta context (package.json is a committed directory, EISDIR)
    layers:
      domain: {}
`;

/**
 * Published layout + the mid-run-failure ingredients + a real git repo.
 * The repo matters even for the --allow-dirty case: pre-B1's git fallback
 * was a silent no-op in a non-repo, so only a git fixture exposes the
 * data-loss differential this suite exists to pin.
 */
async function prepareRollbackFixture(): Promise<ContractFixture> {
  const fix = await createPublishedLayoutFixture(
    ROLLBACK_MANIFEST,
    FIXTURE_PREFIX,
  );

  // Sabotage: package.json as a directory (committed below).
  await fs.mkdir(path.join(fix.root, "packages", "beta", "package.json"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(fix.root, "packages", "beta", "package.json", "placeholder"),
    "",
  );

  // Seeded overwrite: alpha's stale package.json (committed below) gives the
  // journal an UPDATE entry with a real pre-image — see header.
  await fs.mkdir(path.join(fix.root, "packages", "alpha"), { recursive: true });
  await fs.writeFile(
    path.join(fix.root, "packages", "alpha", "package.json"),
    STALE_ALPHA_PKG,
  );

  // Preflight stub (self-regen real runs exec `npx turbo run build`).
  // node_modules/.bin is guaranteed by createPublishedLayoutFixture — it
  // installs the hexagen-lint shim there (published-layout.ts) — so no
  // defensive mkdir here: a missing dir would mean the fixture contract
  // broke, and THAT should fail loudly.
  await fs.writeFile(
    path.join(fix.root, "node_modules", ".bin", "turbo"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 },
  );

  // A tracked file for the dirty-tree case to modify.
  await fs.writeFile(path.join(fix.root, ".gitkeep"), "");

  // node_modules/ (copied dist, symlinked externals, shims) must stay
  // porcelain-invisible; everything else is committed so the clean-tree
  // case starts porcelain-clean.
  await fs.writeFile(path.join(fix.root, ".gitignore"), "node_modules/\n");
  execSync("git init --quiet", { cwd: fix.root });
  execSync('git config user.name "test"', { cwd: fix.root });
  execSync('git config user.email "test@test"', { cwd: fix.root });
  execSync("git add .", { cwd: fix.root });
  execSync('git commit -m "init" --quiet', { cwd: fix.root });

  return fix;
}

function porcelain(root: string): string {
  return execSync("git status --porcelain", { cwd: root, encoding: "utf8" });
}

/** Root-resolution canary — see header. Dry-run EISDIR proves the fixture
 * (with its sabotage) is what the CLI resolved; exit 0 means HOST. */
async function assertCanaryResolvedFixture(fix: ContractFixture) {
  const canary = await runHexagen(fix, ["sync", "--dry-run", "--allow-dirty"]);
  assert.notEqual(
    canary.code,
    0,
    `root-resolution canary: dry-run on the sabotaged fixture exited 0 — refusing to run a real sync that may target the host repo\n${describeResult(canary)}`,
  );
  assert.match(
    canary.stderr,
    /EISDIR|illegal operation on a directory/,
    describeResult(canary),
  );
}

describe(
  "rollback contract — built dist in published layout (PR-B1, RCA #4)",
  { skip: SKIP_NON_POSIX },
  () => {
    beforeAll(assertBuiltArtifactsPresent);

    it("Case A: failed `sync --allow-dirty` NEVER rolls back — untracked + dirty files survive, journal printed", async () => {
      const fix = await prepareRollbackFixture();
      try {
        // The user's in-flight work. Pre-B1: `git clean -fd` deletes
        // scratch.txt, `git reset --hard` empties .gitkeep.
        await fs.writeFile(
          path.join(fix.root, "scratch.txt"),
          "user scratch - must survive\n",
        );
        await fs.writeFile(
          path.join(fix.root, ".gitkeep"),
          "UNCOMMITTED_CHANGE_PATTERN",
        );

        await assertCanaryResolvedFixture(fix);

        const r = await runHexagen(fix, ["sync", "--allow-dirty"]);
        assert.notEqual(r.code, 0, describeResult(r));
        assert.ok(r.stderr.includes("Fatal sync error"), describeResult(r));
        assert.match(
          r.stderr,
          /EISDIR|illegal operation on a directory/,
          describeResult(r),
        );

        assert.equal(
          await fs.readFile(path.join(fix.root, "scratch.txt"), "utf8"),
          "user scratch - must survive\n",
          `untracked scratch file must survive a failed sync (pre-B1 'git clean -fd' deleted it)\n${describeResult(r)}`,
        );
        assert.equal(
          await fs.readFile(path.join(fix.root, ".gitkeep"), "utf8"),
          "UNCOMMITTED_CHANGE_PATTERN",
          `dirty tracked file must keep the user's uncommitted content\n${describeResult(r)}`,
        );
        assert.notEqual(
          await fs.readFile(
            path.join(fix.root, "packages", "alpha", "package.json"),
            "utf8",
          ),
          STALE_ALPHA_PKG,
          `under --allow-dirty NOTHING is reverted — sync's own overwrite stays too, not even restored to the seed\n${describeResult(r)}`,
        );

        // logger.warn → stderr: the deliberate no-rollback notice plus the
        // journal of touched paths. The non-zero count pins the
        // non-empty-journal branch (the empty branch says "nothing to roll
        // back" instead).
        assert.match(
          r.stderr,
          /Sync failed after touching [1-9]\d* path\(s\) — NO rollback under --allow-dirty/,
          describeResult(r),
        );
        assert.match(
          r.stderr,
          /packages\/alpha\/package\.json/,
          `journal print must name the touched paths\n${describeResult(r)}`,
        );
        assert.match(
          r.stderr,
          /packages\/alpha\/tsconfig\.json/,
          `journal print must name alpha's created tsconfig — Case B's unlink assert relies on this being a real create→unlink arc\n${describeResult(r)}`,
        );
        assert.ok(!r.stdout.includes("Rollback completed"), describeResult(r));
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("Case B: failed `sync` on a clean tree rolls back ONLY journaled paths — porcelain-clean after, exit non-zero", async () => {
      const fix = await prepareRollbackFixture();
      try {
        assert.equal(
          porcelain(fix.root),
          "",
          "fixture must be porcelain-clean before the run (precondition: the git check must pass)",
        );

        await assertCanaryResolvedFixture(fix);

        const r = await runHexagen(fix, ["sync"]);
        assert.notEqual(r.code, 0, describeResult(r));
        assert.ok(r.stderr.includes("Fatal sync error"), describeResult(r));
        assert.match(
          r.stderr,
          /EISDIR|illegal operation on a directory/,
          describeResult(r),
        );

        // Every journaled write inverted; only empty directories remain,
        // which porcelain cannot see.
        assert.equal(
          porcelain(fix.root),
          "",
          `after rollback the tree must be porcelain-clean\n${describeResult(r)}`,
        );
        // The seeded OVERWRITE restored byte-identically — the assertion that
        // dies if recordWrite ever journals null pre-images for updates
        // (rollback would unlink the user's file instead). See header.
        assert.equal(
          await fs.readFile(
            path.join(fix.root, "packages", "alpha", "package.json"),
            "utf8",
          ),
          STALE_ALPHA_PKG,
          `alpha's seeded package.json must be restored to its exact pre-sync bytes\n${describeResult(r)}`,
        );
        assert.equal(
          await pathExists(
            path.join(fix.root, "packages", "alpha", "tsconfig.json"),
          ),
          false,
          `alpha's freshly created tsconfig.json must be unlinked by the rollback\n${describeResult(r)}`,
        );

        // logger.info → stdout. Back-reference pins restored === attempted.
        assert.match(
          r.stdout,
          /Rolling back [1-9]\d* journaled path/,
          describeResult(r),
        );
        assert.match(
          r.stdout,
          /Rollback completed: (\d+)\/\1 path\(s\) restored/,
          describeResult(r),
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });
  },
);
