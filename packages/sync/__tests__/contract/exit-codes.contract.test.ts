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
import { describe, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
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
  type ContractFixture,
} from "../helpers/published-layout.js";
import { pathExists } from "../helpers/fs-helpers.js";

// ManifestSchema is strict — one unrecognized top-level key is the minimal,
// realistic corruption (a typo'd key survives YAML parsing but fails zod).
const BROKEN_MANIFEST = `${VALID_MANIFEST}bogus_unknown_key: 1
`;

const FIXTURE_PREFIX = "hexagen-exit-contract-";

/** One git helper for every fixture: identity on the command line, so no fixture has to configure a user. */
function gitIn(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.test", "-c", "user.name=t", ...args],
    { cwd: root, encoding: "utf8" },
  ).trim();
}

/**
 * A git repo in the fixture root, and the commit to hand back. The
 * published-layout fixture has no history, and the `contract` commands need a
 * ref: `--base` reads the sidecar at a commit through `git show`, so a fixture
 * that cannot resolve a ref is the "exit 2, never 0" case and nothing else can
 * be proven there. Only the two manifest files are committed, never
 * `node_modules/`.
 */
function gitInit(root: string): string {
  gitIn(root, "init", "-q");
  gitIn(root, "add", "-f", "package.json", "tsconfig.base.json");
  gitIn(root, "commit", "-q", "-m", "fixture");
  return gitIn(root, "rev-parse", "HEAD");
}

const EMPTY_SECTION = { collected: true, items: [] };

/**
 * The sidecar, staged the way a client must: every writer adds `.hexagen/` to
 * `.git/info/exclude`, so `git add -f` (what `workbook export --stage` does) is
 * the only way in.
 *
 * Both fixture jobs run through here. `add-rule` needs a slice and no scan,
 * left uncommitted so the command writes `contract.json` itself; `contract check
 * --base` needs the slice, the scan and a contract in a commit, because the
 * guard reads them at a ref. `paths` keeps each side's slice as it wrote it.
 */
async function stageSidecar(
  root: string,
  opts: {
    /** The commit the sidecar names; defaults to a fresh `gitInit(root)`. */
    commit?: string;
    /** Slice `paths`; `src/` unless a fixture wants its own. */
    paths?: string[];
    /** Write `observed.json`: the `--base` fixture stages it, `add-rule` never reads one. */
    scan?: boolean;
    /** Write `contract.json`: the committed contract the growth guard compares against. */
    contract?: boolean;
    /** `git add -f` the sidecar and commit it in its own commit. */
    staged?: boolean;
  } = {},
): Promise<void> {
  const commit = opts.commit ?? gitInit(root);
  const sidecar = path.join(root, ".hexagen");
  await fs.mkdir(sidecar, { recursive: true });
  await fs.writeFile(
    path.join(sidecar, "slice.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0.0",
        id: "s1",
        repo: { commit },
        paths: opts.paths ?? ["src/"],
        excludes: [],
        createdBy: "t@example.test",
        createdAt: "2026-10-03T00:00:00.000Z",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  const staged = [".hexagen/slice.json"];
  if (opts.scan === true) {
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
    staged.push(".hexagen/observed.json");
  }
  if (opts.contract === true) {
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
  if (opts.staged === true) {
    gitIn(root, "add", "-f", ...staged);
    gitIn(root, "commit", "-q", "-m", "stage the sidecar");
  }
}

async function readRules(
  fix: ContractFixture,
): Promise<{ kind?: unknown; except?: unknown }[]> {
  const raw = await fs.readFile(
    path.join(fix.root, ".hexagen", "contract.json"),
    "utf8",
  );
  return (JSON.parse(raw) as { rules: { except?: unknown }[] }).rules;
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

  describe("hexagen contract add-rule: the flag parser", () => {
    /**
     * The parser is commander's, so these run the built bundle: the optional
     * value of `--except`, the per-kind flag check and the exit code of a
     * missing `--kind` are all decided before any of this package's code runs.
     */
    async function withSlice(): Promise<ContractFixture> {
      const fix = await createPublishedLayoutFixture(
        VALID_MANIFEST,
        FIXTURE_PREFIX,
      );
      // No scan: `add-rule` reads the slice and writes `contract.json`, and
      // never looks at one.
      await stageSidecar(fix.root);
      return fix;
    }

    it("a bare --except writes a closed rule with no excepts, and exits 0", async () => {
      const fix = await withSlice();
      try {
        const r = await runHexagen(fix, [
          "contract",
          "add-rule",
          "--kind",
          "closed",
          "--except",
          "--yes",
        ]);
        assert.equal(r.code, 0, describeResult(r));
        const [rule] = await readRules(fix);
        assert.equal(rule?.kind, "closed", describeResult(r));
        assert.deepEqual(rule?.except, [], describeResult(r));
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("--except a --except keeps the prefix collected, and exits 0", async () => {
      const fix = await withSlice();
      try {
        const r = await runHexagen(fix, [
          "contract",
          "add-rule",
          "--kind",
          "closed",
          "--except",
          "lib/",
          "--except",
          "--yes",
        ]);
        assert.equal(r.code, 0, describeResult(r));
        assert.deepEqual((await readRules(fix))[0]!.except, ["lib/"]);
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("--from with --kind closed exits 2 and writes nothing", async () => {
      const fix = await withSlice();
      try {
        const r = await runHexagen(fix, [
          "contract",
          "add-rule",
          "--kind",
          "closed",
          "--except",
          "lib/",
          "--from",
          "src/",
          "--yes",
        ]);
        assert.equal(r.code, 2, describeResult(r));
        assert.match(r.stderr, /takes no --from/, describeResult(r));
        assert.equal(
          await pathExists(path.join(fix.root, ".hexagen", "contract.json")),
          false,
          "a refused rule must not write contract.json",
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("a missing --kind exits 2 like every other usage error, and writes nothing", async () => {
      // Commander's own required-option path exits 1, which reads as a failed
      // gate rather than a refused command. The exit code is the contract here.
      const fix = await withSlice();
      try {
        const r = await runHexagen(fix, [
          "contract",
          "add-rule",
          "--except",
          "lib/",
          "--yes",
        ]);
        assert.equal(r.code, 2, describeResult(r));
        assert.match(r.stderr, /--kind/, describeResult(r));
        assert.equal(
          await pathExists(path.join(fix.root, ".hexagen", "contract.json")),
          false,
          "a refused rule must not write contract.json",
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });

    it("--help still exits 0", async () => {
      const fix = await withSlice();
      try {
        const r = await runHexagen(fix, ["contract", "add-rule", "--help"]);
        assert.equal(r.code, 0, describeResult(r));
        assert.match(r.stdout, /--kind/, describeResult(r));
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
        await stageSidecar(fix.root, {
          paths: ["ui/", "api/"],
          scan: true,
          staged: true,
        });
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
        await stageSidecar(fix.root, {
          paths: ["ui/", "api/"],
          scan: true,
          contract: true,
          staged: true,
        });
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
        await stageSidecar(fix.root, {
          paths: ["ui/", "api/"],
          scan: true,
          contract: true,
          staged: true,
        });
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
