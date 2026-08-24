/**
 * `sync --check` drift-gate contract (PR-B2, RCA #5; plan decision D3) — the
 * consumer-CI primitive: exit 0 on a converged tree, exit non-zero iff a plain
 * `sync` would change anything (create/update/delete).
 *
 * RCA #5 background: before PR-B2 a fully converged tree still reported a
 * constant "67–70 created" — layer-folder mkdirs were counted as `created` on
 * every run (mkdir recursive never throws EEXIST, so the catch→skipped branch
 * was dead), shared-kernel filed updates under `created` and `unchanged` under
 * `skipped`, and three generators carried private copies of the routing
 * if-chain. A drift gate is meaningless on top of lying counts, so the
 * converged case here pins BOTH: exit 0 AND the actual numbers (`Total ops :
 * 0`, a Layers row with zero mutations).
 *
 * Like the other contract suites, these tests spawn the BUILT dist/cli.js in
 * the published consumer layout (../helpers/published-layout.ts) so they pin
 * the artifact a consumer runs, not the TS sources. Self-regen real runs exec
 * `npx turbo run build` (preflight); npx resolves node_modules/.bin first, so
 * the stubbed `turbo` keeps the converging sync offline. `--check` itself
 * implies --dry-run, which skips preflight entirely.
 *
 * Semantics pinned here, decided in the plan and the B2 design notes:
 *
 *  - `--check` ⇒ dry-run is resolved at the CLI boundary; the engine returns a
 *    SyncRunSummary and cli.ts makes the exit-code decision (A1 doctrine).
 *  - Drift granularity: every pending change is counted EXACTLY ONCE, because
 *    every generated file has a single owner. package.json is owned by
 *    generatePackageJson; layer barrels are owned by the recursive-barrels
 *    generator (B2 made ensureLayerFolders directories-only — before that it
 *    raced recursive over the same barrels and a converged tree re-planned
 *    14 phantom ops forever). The one residual double-plan — recursive runs
 *    twice per sync, and under dry-run pass 2 re-plans what pass 1 couldn't
 *    write — is collapsed by mergeBarrelPasses, which dedups by path and
 *    recomputes the total from the merged buckets. Both drift cases below pin
 *    the exact count.
 *  - `skipped` is not drift: the fixture's hand-written .gitignore differs
 *    from the generated content and stays protected (no --force-root), on the
 *    converging run and the --check run alike. --check mirrors what a plain
 *    `sync` would do — not what `sync --force-root` would do.
 *  - `--dry-run` WITHOUT `--check` keeps preview semantics: same drifted tree,
 *    exit 0.
 *
 * POSIX-only (shell shims), like the other contract suites.
 */
import assert from "node:assert/strict";
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

// Same layers-armed shape as the dry-run purity suite: generator.sync.layers
// (with subfolders) arms the layer-folder mkdir accounting — the exact RCA #5
// surface — and billing lists real layer content so 6.7(a) still scaffolds
// used folders (the deleted-barrel case below needs a real domain barrel).
const CHECK_MANIFEST = `system: acme-app
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
      domain:
        entities:
          - Invoice
      application:
        use_cases:
          - Charge
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

// -c identity flags: CI runners have no global git user configured.
async function gitCommitAll(root: string, message: string): Promise<void> {
  await runGitOrThrow(["add", "-A"], root);
  await runGitOrThrow(
    [
      "-c",
      "user.email=contract@test.invalid",
      "-c",
      "user.name=Contract Test",
      "commit",
      "-q",
      "-m",
      message,
    ],
    root,
  );
}

/**
 * Fixture in the converged state every case starts from: published layout +
 * turbo stub, baseline commit, ONE real converging sync (exit 0 asserted),
 * everything committed. The tree is porcelain-clean afterwards, so the
 * `--check` runs below need no --allow-dirty — the self-regen git-clean check
 * runs even under dry-run, and these tests deliberately exercise the same
 * committed-tree path a consumer CI job would.
 */
async function createConvergedFixture(
  prefix: string,
): Promise<ContractFixture> {
  const fix = await createPublishedLayoutFixture(CHECK_MANIFEST, prefix);

  // Preflight stub (the converging real run execs `npx turbo run build`).
  // node_modules/.bin is guaranteed by createPublishedLayoutFixture (it
  // installs the hexagen-lint shim there).
  await fs.writeFile(
    path.join(fix.root, "node_modules", ".bin", "turbo"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 },
  );

  // node_modules (copied dist, symlinked externals, shims) stays
  // porcelain-invisible. This .gitignore also doubles as the protected-file
  // probe: it differs from the generated content and must stay `skipped`
  // (never drift) on every run below.
  await fs.writeFile(path.join(fix.root, ".gitignore"), "node_modules/\n");
  await runGitOrThrow(["init", "-q"], fix.root);
  await gitCommitAll(fix.root, "fixture baseline");

  const sync = await runHexagen(fix, ["sync"]);
  assert.equal(
    sync.code,
    0,
    `converging sync must succeed:\n${describeResult(sync)}`,
  );
  await gitCommitAll(fix.root, "converged");

  return fix;
}

describe("sync --check drift-gate contract — built dist in published layout", () => {
  beforeAll(assertBuiltArtifactsPresent);

  it("converged tree: --check exits 0 and the counts are truthful zeros (RCA #5)", async () => {
    const fix = await createConvergedFixture("hexagen-check-converged-");
    try {
      const r = await runHexagen(fix, ["sync", "--check"]);
      assert.equal(
        r.code,
        0,
        `--check on a converged tree must exit 0:\n${describeResult(r)}`,
      );

      // THE RCA #5 pin. Pre-B2 this row read "67–70 created" on a converged
      // tree (every-run mkdir counting); now directories are probed first
      // and only an actually-absent one counts.
      assert.match(
        r.stdout,
        /• Layers : 0 created, 0 updated, 0 deleted/,
        `expected a zero-mutation Layers row:\n${describeResult(r)}`,
      );
      assert.ok(
        r.stdout.includes("• Total ops : 0"),
        `converged tree must plan zero ops:\n${describeResult(r)}`,
      );
      assert.ok(
        !r.stderr.includes("Drift detected"),
        `no drift message expected on a converged tree:\n${describeResult(r)}`,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("missing manifest: --check exits 1 naming the precondition; plain --dry-run still previews (exit 0)", async () => {
    const fix = await createConvergedFixture("hexagen-check-no-manifest-");
    try {
      // cwd-first resolution (Wave C) makes a manifest-less run reachable by
      // standing in the wrong directory. Remove the manifest, commit the
      // clean tree: a verification gate must REFUSE to certify a tree it
      // never measured, rather than synthesize empty and green-light it.
      await fs.rm(path.join(fix.root, ".architecture", "manifest.yaml"));
      await gitCommitAll(fix.root, "drift: remove the manifest");

      const check = await runHexagen(fix, ["sync", "--check"]);
      assert.equal(
        check.code,
        1,
        `--check without a manifest must exit 1:\n${describeResult(check)}`,
      );
      assert.ok(
        check.stderr.includes("Manifest not found") &&
          check.stderr.includes("--check"),
        `expected a manifest-missing failure naming --check:\n${describeResult(check)}`,
      );

      // Decision D3 unchanged: plain --dry-run keeps preview semantics and
      // tolerates the absent manifest (exit 0) — only the gate is strict.
      const preview = await runHexagen(fix, ["sync", "--dry-run"]);
      assert.equal(
        preview.code,
        0,
        `plain --dry-run must tolerate a missing manifest (preview):\n${describeResult(preview)}`,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("deleted generated package.json: --check exits 1 with exactly one pending change; plain --dry-run still exits 0", async () => {
    const fix = await createConvergedFixture("hexagen-check-drift-pkg-");
    try {
      const pkgRel = path.join("packages", "billing", "package.json");
      await fs.rm(path.join(fix.root, pkgRel));
      // Commit the drift: --check runs the same self-regen git-clean check
      // as a real sync, and consumer CI gates committed trees anyway.
      await gitCommitAll(fix.root, "drift: remove generated package.json");

      const check = await runHexagen(fix, ["sync", "--check"]);
      // cli.ts sets process.exitCode = 1 for drift — pin the specific code
      // so a crash path (also non-zero) can't satisfy this case.
      assert.equal(
        check.code,
        1,
        `--check on a drifted tree must exit 1:\n${describeResult(check)}`,
      );
      // package.json has a single owner (generatePackageJson), so the
      // planned-op count is exact — this is the truthful-counts pin from
      // the drift side.
      assert.ok(
        check.stderr.includes(
          "Drift detected: 1 pending change(s) (1 to create, 0 to update, 0 to delete)",
        ),
        `expected an exact one-change drift message:\n${describeResult(check)}`,
      );
      assert.ok(
        check.stdout.includes("[DRY-RUN] would create") &&
          check.stdout.includes(pkgRel),
        `expected the planned create to name ${pkgRel}:\n${describeResult(check)}`,
      );

      // Same tree, no --check: preview semantics, exit 0 (decision D3 —
      // the gate is opt-in; --dry-run alone never fails on drift).
      const preview = await runHexagen(fix, ["sync", "--dry-run"]);
      assert.equal(
        preview.code,
        0,
        `plain --dry-run must keep preview semantics on a drifted tree:\n${describeResult(preview)}`,
      );
      assert.ok(
        !preview.stderr.includes("Drift detected"),
        `--dry-run must not emit the drift gate message:\n${describeResult(preview)}`,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("generator failure is NOT convergence: --check and a real sync both exit 1 and name the failure (review B-1)", async () => {
    const fix = await createConvergedFixture("hexagen-check-genfail-");
    try {
      // Sabotage one generator's target so its catch-into-result.error path
      // fires: tsconfig.json as a DIRECTORY makes safeWriteFileAtomic's
      // pre-read throw EISDIR (not ENOENT), which generateTsconfig catches
      // into result.error — the Wave-2e failed-soft contract. Pre-B-1 this
      // run printed `Sync completed successfully` + `Total ops : 0` and
      // exited 0 with no trace of the failure anywhere in the output.
      const tsRel = path.join("packages", "billing", "tsconfig.json");
      await fs.rm(path.join(fix.root, tsRel));
      await fs.mkdir(path.join(fix.root, tsRel));
      await fs.writeFile(path.join(fix.root, tsRel, ".keep"), "");
      await gitCommitAll(fix.root, "sabotage: tsconfig.json is a directory");

      const check = await runHexagen(fix, ["sync", "--check"]);
      assert.equal(
        check.code,
        1,
        `--check must exit 1 when a generator failed-soft:\n${describeResult(check)}`,
      );
      // The failure must be NAMED, module included — pre-B-1 the catch was
      // a total swallow (no log line, no report entry, no exit effect).
      assert.ok(
        check.stderr.includes("tsconfig generation failed for billing"),
        `expected the failed generator to be named:\n${describeResult(check)}`,
      );
      assert.ok(
        check.stderr.includes("Sync incomplete: 1 generator failure(s)"),
        `expected the CLI failure verdict:\n${describeResult(check)}`,
      );
      assert.ok(
        check.stderr.includes("FAILED"),
        `expected a FAILED summary row:\n${describeResult(check)}`,
      );
      // Errors are a failure, not drift: the drift message must not fire
      // for them (zero ops were planned).
      assert.ok(
        !check.stderr.includes("Drift detected"),
        `generator failure must not masquerade as drift:\n${describeResult(check)}`,
      );

      // The REAL path is equally honest (the errors branch in cli.ts is
      // mode-independent per the A1 doctrine) — and failed-soft generators
      // do NOT trigger the journal rollback: the run completes, the tree
      // keeps its converged files, only the exit code says incomplete.
      const real = await runHexagen(fix, ["sync"]);
      assert.equal(
        real.code,
        1,
        `a real sync with a failed generator must exit 1:\n${describeResult(real)}`,
      );
      assert.ok(
        real.stderr.includes("tsconfig generation failed for billing"),
        `real run must name the failure too:\n${describeResult(real)}`,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });

  it("deleted layer barrel: --check exits 1 with exactly one pending change (single barrel owner + two-pass dedup)", async () => {
    const fix = await createConvergedFixture("hexagen-check-drift-barrel-");
    try {
      const barrelRel = path.join(
        "packages",
        "billing",
        "src",
        "domain",
        "index.ts",
      );
      // The converged fixture's billing domain is empty, and since
      // 2026-08-23 an empty layer gets NO barrel (ADR-0050 — the
      // `export {};` stub emitter was removed). Deleting a stub that no
      // longer exists is not drift. Give the layer a real source file and
      // re-converge so the barrel is a real one; deleting THAT is the
      // drift this test exists to measure (exactly one pending create).
      await fs.writeFile(
        path.join(fix.root, "packages", "billing", "src", "domain", "price.ts"),
        "export const price = 1;\n",
      );
      await gitCommitAll(fix.root, "add a real domain source file");
      const reconverge = await runHexagen(fix, ["sync"]);
      assert.equal(
        reconverge.code,
        0,
        `re-converging sync must succeed:\n${describeResult(reconverge)}`,
      );
      await gitCommitAll(fix.root, "converged with a real domain barrel");
      const realBarrel = await fs.readFile(
        path.join(fix.root, barrelRel),
        "utf8",
      );
      assert.match(
        realBarrel,
        /export \* from "\.\/price\.js";/,
        `fixture barrel must be real, not a stub:\n${realBarrel}`,
      );
      await fs.rm(path.join(fix.root, barrelRel));
      await gitCommitAll(fix.root, "drift: remove layer barrel");

      const check = await runHexagen(fix, ["sync", "--check"]);
      assert.equal(
        check.code,
        1,
        `--check must flag a deleted layer barrel:\n${describeResult(check)}`,
      );
      // Exactly one: recursive-barrels is the barrel's single owner (B2
      // removed ensureLayerFolders' competing write), and mergeBarrelPasses
      // collapses the dry-run pass-1/pass-2 re-plan of the same create
      // (see header). This pin is what proves the churn fix end-to-end.
      assert.ok(
        check.stderr.includes(
          "Drift detected: 1 pending change(s) (1 to create, 0 to update, 0 to delete)",
        ),
        `expected an exact one-change drift message:\n${describeResult(check)}`,
      );
      assert.ok(
        check.stdout.includes("[DRY-RUN] would create") &&
          check.stdout.includes(barrelRel),
        `expected the planned create to name ${barrelRel}:\n${describeResult(check)}`,
      );
    } finally {
      await cleanupFixture(fix.root);
    }
  });
});
