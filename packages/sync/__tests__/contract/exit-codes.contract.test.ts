/**
 * Exit-code contract suite — runs the BUILT artifacts the way a consumer does
 * (plan: docs/planning/sync-toolchain-development-plan.md, PR-A1).
 *
 * Every failure mode of `hexagen` / `hexagen-lint` must exit non-zero. The
 * consumer-project incident (RCA #2) was a `sync --dry-run` failure that
 * exited 0; these tests spawn the real `dist/cli.js` so the contract is pinned
 * against what ships, not against in-process engine behaviour. The fixture
 * layout rationale and process plumbing live in
 * ../helpers/published-layout.ts (shared with the dry-run purity suite, PR-A2).
 *
 * Known gap: NO test anywhere exercises a failure AFTER lock acquisition —
 * every failure inducible here (manifest parse, validation) fires before the
 * engine takes .sync.lock (sync-engine.ts: loadManifest at ~244, acquire at
 * ~258), so the "leaves no lock file" assertion below also passed pre-A1.
 * The post-acquire path (e.g. failing preflight build → finally releases the
 * lock) is correct by inspection and owner-checked (lock.ts); its test rides
 * the A2/B1 rollback work. The capstone's broken-manifest phase
 * (scripts/capstone/first-run-green.js) covers the pack→install→run pipeline
 * for the parse-failure case only.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  VALID_MANIFEST,
  createPublishedLayoutFixture,
  runHexagen,
  runLint,
  describeResult,
  cleanupFixture,
  assertBuiltArtifactsPresent,
} from "../helpers/published-layout.js";
import { pathExists } from "../helpers/fs-helpers.js";

// ManifestSchema is strict — one unrecognized top-level key is the minimal,
// realistic corruption (a typo'd key survives YAML parsing but fails zod).
const BROKEN_MANIFEST = `${VALID_MANIFEST}bogus_unknown_key: 1
`;

const FIXTURE_PREFIX = "hexagen-exit-contract-";

/**
 * A git repo in the fixture root. The published-layout fixture has none today,
 * and `contract check --base` needs history: the guard reads the sidecar at a
 * commit through `git show`, so a fixture that cannot resolve a ref is exactly
 * the "exit 2, never 0" case and nothing else can be proven there.
 */
function gitInit(root: string): string {
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  git("add", "-f", "package.json", "tsconfig.base.json");
  git("commit", "-q", "-m", "fixture");
  return git("rev-parse", "HEAD");
}

const EMPTY_SECTION = { collected: true, items: [] };

/**
 * Stage `.hexagen/` the way a client must: the sidecar is excluded from every
 * writer, so `git add -f` (what `workbook export --stage` does) is the only way
 * in. `contract: false` leaves contract.json out of the base commit, which is
 * the "never staged" precondition failure.
 */
async function stageSidecar(
  root: string,
  commit: string,
  opts: { contract: boolean },
): Promise<void> {
  const sidecar = path.join(root, ".hexagen");
  await fs.mkdir(sidecar, { recursive: true });
  await fs.writeFile(
    path.join(sidecar, "slice.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0.0",
        id: "s1",
        repo: { commit },
        paths: ["ui/", "api/"],
        excludes: [],
        createdBy: "t@example.test",
        createdAt: "2026-10-03T00:00:00.000Z",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(sidecar, "observed.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0.0",
        repo: { commit },
        generatedAt: "2026-10-03T00:00:00.000Z",
        packages: EMPTY_SECTION,
        languages: EMPTY_SECTION,
        build: EMPTY_SECTION,
        generated: EMPTY_SECTION,
        dontTouch: EMPTY_SECTION,
        edges: { collected: true, unreadLanguages: [], items: [] },
        unresolved: EMPTY_SECTION,
        limits: { truncated: false, reasons: [] },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  const staged = [".hexagen/slice.json", ".hexagen/observed.json"];
  if (opts.contract) {
    await fs.writeFile(
      path.join(sidecar, "contract.json"),
      JSON.stringify(
        {
          schemaVersion: "1.0.0",
          sliceId: "s1",
          rules: [
            {
              id: "no-ui-api",
              kind: "forbid",
              from: "ui/",
              to: "api/",
              severity: "error",
            },
          ],
          knownViolations: [],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    staged.push(".hexagen/contract.json");
  }
  execFileSync("git", ["add", "-f", ...staged], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "stage the sidecar"], {
    cwd: root,
  });
}

describe("exit-code contract — built dist in published layout", () => {
  beforeAll(assertBuiltArtifactsPresent);

  describe("hexagen (sync CLI)", () => {
    it("--version exits 0 (bundle loads, parseAsync tail intact)", async () => {
      const fix = await createPublishedLayoutFixture(
        VALID_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        const r = await runHexagen(fix, ["--version"]);
        assert.equal(r.code, 0, describeResult(r));
        assert.match(r.stdout, /\d+\.\d+\.\d+/, describeResult(r));
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("sync --dry-run on a valid manifest exits 0", async () => {
      const fix = await createPublishedLayoutFixture(
        VALID_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        const r = await runHexagen(fix, ["sync", "--dry-run", "--allow-dirty"]);
        assert.equal(r.code, 0, describeResult(r));
        assert.ok(
          r.stdout.includes("Sync completed successfully"),
          describeResult(r),
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("sync --dry-run on a broken manifest exits non-zero (RCA #2 — was exit 0)", async () => {
      const fix = await createPublishedLayoutFixture(
        BROKEN_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        const r = await runHexagen(fix, ["sync", "--dry-run", "--allow-dirty"]);
        assert.notEqual(r.code, 0, describeResult(r));
        assert.ok(
          r.stderr.includes("Failed to parse manifest"),
          describeResult(r),
        );
        // The CLI layer (not the engine) must surface the failure.
        assert.ok(r.stderr.includes("Fatal sync error"), describeResult(r));
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("real sync on a broken manifest exits non-zero and leaves no lock file", async () => {
      const fix = await createPublishedLayoutFixture(
        BROKEN_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        // Root-resolution canary: if findWorkspaceRoot ever resolved the
        // HOST repo instead of the fixture (dist symlinked rather than
        // copied, or the walk-up logic changed), the host's VALID manifest
        // would make this dry-run exit 0. Abort before the real sync below
        // can mutate the host repo.
        const canary = await runHexagen(fix, [
          "sync",
          "--dry-run",
          "--allow-dirty",
        ]);
        assert.notEqual(
          canary.code,
          0,
          `root-resolution canary: dry-run on the broken fixture exited 0 — refusing to run a real sync that may target the host repo\n${describeResult(canary)}`,
        );

        const r = await runHexagen(fix, ["sync", "--allow-dirty"]);
        assert.notEqual(r.code, 0, describeResult(r));
        // Same two-layer check as the dry-run case: the failure must be the
        // manifest parse error, surfaced by the CLI — not something incidental.
        assert.ok(
          r.stderr.includes("Failed to parse manifest"),
          describeResult(r),
        );
        assert.equal(
          await pathExists(path.join(fix.root, ".architecture", ".sync.lock")),
          false,
          "a failed sync must not leave .sync.lock behind",
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("arch validate on a broken manifest exits non-zero", async () => {
      const fix = await createPublishedLayoutFixture(
        BROKEN_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        const r = await runHexagen(fix, ["arch", "validate"]);
        assert.notEqual(r.code, 0, describeResult(r));
        // Pins that validate actually REACHED the linter (shim resolved via
        // node_modules/.bin walk-up) and failed on the manifest — without
        // these, a missing shim ("arch-linter not found") also exits 1 and
        // the test would pass while validating nothing.
        assert.ok(
          r.stderr.includes("Architecture violations detected"),
          describeResult(r),
        );
        assert.ok(
          r.stderr.includes("Could not load architecture manifest"),
          describeResult(r),
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });
  });

  describe("hexagen contract check --base (growth guard)", () => {
    it("exits 2 in a repo with no .hexagen/ at all", async () => {
      const fix = await createPublishedLayoutFixture(
        VALID_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        gitInit(fix.root);
        const r = await runHexagen(fix, [
          "contract",
          "check",
          "--base",
          "HEAD",
        ]);
        assert.equal(r.code, 2, describeResult(r));
        assert.ok(r.stderr.includes("slice does not exist"), describeResult(r));
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("exits 2 when contract.json was never staged at the base", async () => {
      const fix = await createPublishedLayoutFixture(
        VALID_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        const commit = gitInit(fix.root);
        await stageSidecar(fix.root, commit, { contract: false });
        const r = await runHexagen(fix, [
          "contract",
          "check",
          "--base",
          "HEAD",
        ]);
        assert.equal(r.code, 2, describeResult(r));
        assert.ok(
          r.stderr.includes("absent at base because it was never staged"),
          describeResult(r),
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("exits 0 with a committed contract that has not grown", async () => {
      const fix = await createPublishedLayoutFixture(
        VALID_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        const commit = gitInit(fix.root);
        await stageSidecar(fix.root, commit, { contract: true });
        const r = await runHexagen(fix, [
          "contract",
          "check",
          "--base",
          "HEAD",
        ]);
        assert.equal(r.code, 0, describeResult(r));
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("exits 1 when the working tree weakens the committed contract", async () => {
      const fix = await createPublishedLayoutFixture(
        VALID_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        const commit = gitInit(fix.root);
        await stageSidecar(fix.root, commit, { contract: true });
        const file = path.join(fix.root, ".hexagen", "contract.json");
        const contract = JSON.parse(await fs.readFile(file, "utf8"));
        contract.rules[0].severity = "warn";
        await fs.writeFile(
          file,
          JSON.stringify(contract, null, 2) + "\n",
          "utf8",
        );
        const r = await runHexagen(fix, [
          "contract",
          "check",
          "--base",
          "HEAD",
        ]);
        assert.equal(r.code, 1, describeResult(r));
        const out = r.stdout + r.stderr;
        assert.ok(out.includes("growth"), describeResult(r));
        assert.ok(out.includes("no-ui-api"), describeResult(r));
        assert.ok(out.includes("severity"), describeResult(r));
      } finally {
        await cleanupFixture(fix.root);
      }
    });
  });

  describe("hexagen-lint", () => {
    it("broken manifest exits non-zero", async () => {
      const fix = await createPublishedLayoutFixture(
        BROKEN_MANIFEST,
        FIXTURE_PREFIX,
      );
      try {
        const r = await runLint(fix);
        assert.notEqual(r.code, 0, describeResult(r));
        // The linter's own diagnostic — proves it ran and failed on the
        // manifest, not on something environmental.
        assert.ok(
          r.stderr.includes("Could not load architecture manifest"),
          describeResult(r),
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("cross-context import violation exits non-zero", async () => {
      const manifest = `system: acme-app
scope: acme
architecture: modular-monolith
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
      const fix = await createPublishedLayoutFixture(manifest, FIXTURE_PREFIX);
      try {
        // Constrain ts-morph to the violating file — createFixture's empty
        // tsconfig.base.json would otherwise pull in node_modules.
        await fs.writeFile(
          path.join(fix.root, "tsconfig.base.json"),
          JSON.stringify(
            {
              compilerOptions: {
                target: "es2022",
                moduleResolution: "bundler",
              },
              include: ["packages/*/src/**/*.ts"],
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );
        const violator = path.join(
          fix.root,
          "packages",
          "billing",
          "src",
          "domain",
        );
        await fs.mkdir(violator, { recursive: true });
        // billing must not import another context's package directly.
        await fs.writeFile(
          path.join(violator, "violator.ts"),
          `import { whatever } from "@acme/orders";\nexport const x = whatever;\n`,
          "utf8",
        );

        const r = await runLint(fix);
        assert.notEqual(r.code, 0, describeResult(r));
        assert.match(r.stdout + r.stderr, /violation/i, describeResult(r));
      } finally {
        await cleanupFixture(fix.root);
      }
    });
  });
});
