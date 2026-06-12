/**
 * Exit-code contract suite — runs the BUILT artifacts the way a consumer does
 * (plan: docs/planning/sync-toolchain-development-plan.md, PR-A1).
 *
 * Every failure mode of `hexagen` / `hexagen-lint` must exit non-zero. The
 * campaign-foundry incident (RCA #2) was a `sync --dry-run` failure that
 * exited 0; these tests spawn the real `dist/cli.js` so the contract is pinned
 * against what ships, not against in-process engine behaviour.
 *
 * Layout matters: `findWorkspaceRoot` (sync-engine-init.ts) walks up from the
 * module's own __dirname — NOT from cwd. Spawning the repo's dist directly
 * would therefore resolve the HOST repo as workspace root and sync *it*. The
 * fixture must replicate the published layout instead:
 *
 *   <fixture>/node_modules/@hexagen-monaco/sync/dist/   ← physical COPY
 *
 * A copy, not a symlink: the ESM loader realpaths import.meta.url, so a
 * symlinked dist would walk up from the repo again. The tsup bundle keeps
 * commander / js-yaml / ts-morph external (ADR-0009) — those ARE symlinked
 * into the fixture's node_modules, because Node resolves their own deps from
 * their realpath inside the host repo, which is exactly what we want.
 *
 * `hexagen-lint` resolves its root from process.cwd() instead, so a .bin shim
 * that exec's the repo's built linter is faithful for it.
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
 *
 * POSIX-only: the .bin shim is a shell script. Dev and CI are darwin/linux;
 * win32 would need a .cmd shim, so the suite skips there instead of lying.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFixture, removeFixture } from "../helpers/fixture-factory.js";
import { pathExists } from "../helpers/fs-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SYNC_DIST = path.join(REPO_ROOT, "packages", "sync", "dist");
const LINTER_DIST = path.join(
  REPO_ROOT,
  "tools",
  "arch-linter",
  "dist",
  "index.js",
);
// Externalized by tsup (ADR-0009) — must be resolvable next to the copied dist.
const EXTERNALS = ["commander", "js-yaml", "ts-morph"];

const SKIP = process.platform === "win32";

const VALID_MANIFEST = `system: acme-app
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    description: Shared primitives
    layers:
      domain: {}
`;

// ManifestSchema is strict — one unrecognized top-level key is the minimal,
// realistic corruption (a typo'd key survives YAML parsing but fails zod).
const BROKEN_MANIFEST = `${VALID_MANIFEST}bogus_unknown_key: 1
`;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runProcess(
  file: string,
  args: string[],
  cwd: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // A numeric code means the binary ran to completion and chose its own
        // exit. Anything else (ENOENT/EACCES spawn failure, timeout, signal
        // kill) REJECTS instead of masquerading as exit≠0: most cases below
        // expect failure, and a binary that never ran would otherwise satisfy
        // `assert.notEqual(code, 0)` without proving any CLI behaviour.
        if (error && typeof error.code !== "number") {
          reject(
            new Error(
              `${file} did not exit on its own (${error.code ?? error.signal ?? error.message})\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
            ),
          );
          return;
        }
        resolve({
          code: typeof error?.code === "number" ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function runNode(
  scriptPath: string,
  args: string[],
  cwd: string,
): Promise<RunResult> {
  return runProcess(process.execPath, [scriptPath, ...args], cwd);
}

interface ContractFixture {
  root: string;
  /** The consumer-side copy of dist/cli.js — the artifact under test. */
  cli: string;
  /** The consumer-side .bin shim for hexagen-lint. */
  lintBin: string;
}

async function createPublishedLayoutFixture(
  manifestYaml: string,
): Promise<ContractFixture> {
  const root = await createFixture([], "hexagen-exit-contract-");

  await fs.mkdir(path.join(root, "packages"), { recursive: true });
  await fs.mkdir(path.join(root, ".architecture"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".architecture", "manifest.yaml"),
    manifestYaml,
    "utf8",
  );

  const pkgDir = path.join(root, "node_modules", "@hexagen-monaco", "sync");
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.cp(SYNC_DIST, path.join(pkgDir, "dist"), { recursive: true });
  // Guard the copy-not-symlink invariant: a symlinked dist realpaths back
  // into the repo, and findWorkspaceRoot would resolve the HOST as workspace
  // root (see header). lstat does not follow links, so isDirectory() is
  // false for a symlink.
  assert.ok(
    (await fs.lstat(path.join(pkgDir, "dist"))).isDirectory(),
    "fixture dist must be a physical copy, not a symlink",
  );
  // "type": "module" mirrors the published package.json — without it the
  // copied .js bundle would be loaded as CJS and top-level await would throw.
  await fs.writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@hexagen-monaco/sync",
        version: "0.0.0-contract",
        type: "module",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  for (const ext of EXTERNALS) {
    await fs.symlink(
      path.join(REPO_ROOT, "node_modules", ext),
      path.join(root, "node_modules", ext),
      "dir",
    );
  }

  const binDir = path.join(root, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  const lintBin = path.join(binDir, "hexagen-lint");
  await fs.writeFile(
    lintBin,
    `#!/bin/sh\nexec "${process.execPath}" "${LINTER_DIST}" "$@"\n`,
    { mode: 0o755 },
  );

  return { root, cli: path.join(pkgDir, "dist", "cli.js"), lintBin };
}

function runHexagen(fix: ContractFixture, args: string[]): Promise<RunResult> {
  return runNode(fix.cli, args, fix.root);
}

function runLint(fix: ContractFixture): Promise<RunResult> {
  return runProcess(fix.lintBin, [], fix.root);
}

function describeResult(r: RunResult): string {
  return `exit=${r.code}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

// finally-safe cleanup: a throwing fs.rm (EBUSY under CI, etc.) must never
// replace the test's own assertion error. Worst case is an orphaned tmp dir.
async function cleanupFixture(root: string): Promise<void> {
  try {
    await removeFixture(root);
  } catch (err) {
    console.warn(`fixture cleanup failed (${root}):`, err);
  }
}

describe(
  "exit-code contract — built dist in published layout",
  { skip: SKIP },
  () => {
    before(async () => {
      // Fail closed with a pointer instead of a confusing spawn error: the suite
      // tests built artifacts, so both dists must exist (turbo wires test→build).
      assert.ok(
        await pathExists(path.join(SYNC_DIST, "cli.js")),
        `missing ${SYNC_DIST}/cli.js — build @hexagen/sync before running the contract suite`,
      );
      assert.ok(
        await pathExists(LINTER_DIST),
        `missing ${LINTER_DIST} — build @hexagen/arch-linter before running the contract suite`,
      );
    });

    describe("hexagen (sync CLI)", () => {
      it("--version exits 0 (bundle loads, parseAsync tail intact)", async () => {
        const fix = await createPublishedLayoutFixture(VALID_MANIFEST);
        try {
          const r = await runHexagen(fix, ["--version"]);
          assert.equal(r.code, 0, describeResult(r));
          assert.match(r.stdout, /\d+\.\d+\.\d+/, describeResult(r));
        } finally {
          await cleanupFixture(fix.root);
        }
      });

      it("sync --dry-run on a valid manifest exits 0", async () => {
        const fix = await createPublishedLayoutFixture(VALID_MANIFEST);
        try {
          const r = await runHexagen(fix, [
            "sync",
            "--dry-run",
            "--allow-dirty",
          ]);
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
        const fix = await createPublishedLayoutFixture(BROKEN_MANIFEST);
        try {
          const r = await runHexagen(fix, [
            "sync",
            "--dry-run",
            "--allow-dirty",
          ]);
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
        const fix = await createPublishedLayoutFixture(BROKEN_MANIFEST);
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
            await pathExists(
              path.join(fix.root, ".architecture", ".sync.lock"),
            ),
            false,
            "a failed sync must not leave .sync.lock behind",
          );
        } finally {
          await cleanupFixture(fix.root);
        }
      });

      it("arch validate on a broken manifest exits non-zero", async () => {
        const fix = await createPublishedLayoutFixture(BROKEN_MANIFEST);
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

    describe("hexagen-lint", () => {
      it("broken manifest exits non-zero", async () => {
        const fix = await createPublishedLayoutFixture(BROKEN_MANIFEST);
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
        const fix = await createPublishedLayoutFixture(manifest);
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
  },
);
