import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import { LockFile } from "../../src/lock.js";
import type { SyncFlags, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";

// -----------------------------------------------------------------------------
// HOST-REPO resolution for the before/after `git status` safety net.
//
// The contract of the bug-fix under test is: SyncEngine.run() must NEVER touch
// the host repo's working tree, regardless of process.cwd(). Every test in
// the "non-dry-run / self-regen" block below snapshots the host repo's git
// status before and after and asserts equality.
//
// We locate the host repo by walking up from __dirname until we find the
// enclosing git repository (the nearest ancestor containing a `.git` entry —
// either a directory or a worktree gitfile). This is robust against the
// monorepo being checked out as a worktree.
// -----------------------------------------------------------------------------

function locateHostRepoRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  while (dir !== path.parse(dir).root) {
    try {
      // .git is a directory in a normal clone, a regular file in a worktree
      execSync("git rev-parse --show-toplevel", {
        cwd: dir,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return execSync("git rev-parse --show-toplevel", {
        cwd: dir,
        encoding: "utf8",
      }).trim();
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error("locateHostRepoRoot: could not find enclosing git repo");
}

const HOST_REPO_ROOT = locateHostRepoRoot();

function hostRepoGitStatus(): string {
  return execSync("git status --porcelain", {
    cwd: HOST_REPO_ROOT,
    encoding: "utf8",
  });
}

// -----------------------------------------------------------------------------
// Fixture-repo helper — creates a real git repo in a temp dir with one HEAD
// commit. Used by the non-dry-run / self-regen tests added below so that the
// engine's git commands (git status, git reset --hard, git clean) operate on
// the FIXTURE and never on the host.
// -----------------------------------------------------------------------------

async function makeFixtureRepo(tmpDir: string): Promise<void> {
  execSync("git init --quiet", { cwd: tmpDir });
  execSync('git config user.name "test"', { cwd: tmpDir });
  execSync('git config user.email "test@test"', { cwd: tmpDir });
  // Ensure a deterministic default branch so `git reset --hard HEAD` has a ref.
  execSync("git checkout -b main --quiet 2>/dev/null || true", { cwd: tmpDir });
  await fs.writeFile(path.join(tmpDir, ".gitkeep"), "");
  execSync("git add .", { cwd: tmpDir });
  execSync('git commit -m "init" --quiet', { cwd: tmpDir });
}

// Small helper: run `fn` with process.exit spied. Returns the captured exit
// codes and ensures the original is restored on every path. The spy throws
// when process.exit is invoked, which propagates out of the engine's run()
// (because run() does not itself catch synchronous throws from process.exit).
function withProcessExitSpy<T>(
  fn: (exitCalls: Array<number | undefined>) => Promise<T>,
): Promise<T> {
  const exitCalls: Array<number | undefined> = [];
  const originalExit = process.exit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).exit = ((code?: number) => {
    exitCalls.push(code);
    throw new Error(`__process_exit_spy__(${code})`);
  }) as never;

  return fn(exitCalls).finally(() => {
    process.exit = originalExit;
  });
}

/**
 * Error-path integration tests for SyncEngine (packages/sync/src/sync-engine.ts).
 *
 * Companion to idempotency.test.ts, which covers happy-path external-mode runs.
 * This file focuses on failure modes reachable WITHOUT touching the host
 * repository's git state or real `process.cwd()`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SAFETY CONTRACT — READ BEFORE ADDING TESTS HERE
 * ──────────────────────────────────────────────────────────────────────────
 *
 * SyncEngine.run() contains two `execAsync` calls that are hard-coded to
 * `process.cwd()` (no `cwd` option):
 *
 *   sync-engine.ts:284   execAsync("git status --porcelain")
 *   sync-engine.ts:382   execAsync("git reset --hard HEAD && git clean -fd")
 *
 * The second command is *destructive*: it resets the working tree and
 * deletes untracked files in whatever cwd the test process happens to be in.
 * Because AGENTS.md forbids `process.chdir()` in tests and because the test
 * process inherits the host repository cwd, any test that lets the engine
 * reach either execAsync line risks corrupting the host worktree.
 *
 * The rollback branch is reached whenever an error is thrown inside the
 * `try` block (sync-engine.ts:312-375) AND `!dryRun`. Therefore every test
 * in this file that deliberately triggers an error MUST also set
 * `dryRun: true` — that short-circuits the rollback path at sync-engine.ts:380.
 *
 * Similarly, the git-clean check at sync-engine.ts:282 runs whenever
 * `mode === "self-regen" && !allowDirty`. Every test here uses
 * `mode: "external"`, which skips both the git check AND the preflight
 * `npx turbo run build` that would otherwise pollute the host workspace.
 *
 * See the top-of-file banner in idempotency.test.ts for the same
 * external-mode rationale applied to happy paths.
 * ──────────────────────────────────────────────────────────────────────────
 */

// -----------------------------------------------------------------------------
// Logger spy — captures level + message pairs for assertion
// -----------------------------------------------------------------------------

interface LogCall {
  level: "error" | "warn" | "info" | "debug";
  message: string;
}

function createSpyLogger(): LoggerPort & { calls: LogCall[] } {
  const calls: LogCall[] = [];
  return {
    calls,
    error: (msg) => {
      calls.push({ level: "error", message: msg });
    },
    warn: (msg) => {
      calls.push({ level: "warn", message: msg });
    },
    info: (msg) => {
      calls.push({ level: "info", message: msg });
    },
    debug: (msg) => {
      calls.push({ level: "debug", message: msg });
    },
    errorWithException: (_err, msg) => {
      calls.push({ level: "error", message: msg ?? "errorWithException" });
    },
  };
}

function messagesAt(
  logger: { calls: LogCall[] },
  level: LogCall["level"],
): string[] {
  return logger.calls.filter((c) => c.level === level).map((c) => c.message);
}

// -----------------------------------------------------------------------------
// Flags builder — external + dry-run is the safe default for error tests
// -----------------------------------------------------------------------------

interface FlagOverrides {
  dryRun?: boolean;
  logger?: LoggerPort;
}

function makeExternalDryRunFlags(overrides: FlagOverrides = {}): SyncFlags {
  return {
    dryRun: overrides.dryRun ?? true,
    force: false,
    forceRoot: false,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger: overrides.logger ?? createSpyLogger(),
  };
}

interface SelfRegenFlagOverrides {
  dryRun?: boolean;
  allowDirty?: boolean;
  logger?: LoggerPort;
}

function makeSelfRegenFlags(overrides: SelfRegenFlagOverrides = {}): SyncFlags {
  return {
    dryRun: overrides.dryRun ?? false,
    force: false,
    forceRoot: false,
    allowDirty: overrides.allowDirty ?? false,
    strict: false,
    mode: "self-regen",
    logger: overrides.logger ?? createSpyLogger(),
  };
}

// -----------------------------------------------------------------------------
// Fixture monorepo — same shape as idempotency.test.ts::createFixture
// -----------------------------------------------------------------------------

const WORKSPACE_TSCONFIG = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: true,
    composite: true,
    tsBuildInfoFile: "./dist/tsconfig.tsbuildinfo",
    paths: {},
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist", ".turbo"],
  references: [] as Array<{ path: string }>,
};

const LAYERS_TEMPLATE = {
  domain: { folder: "src/domain" },
  application: {
    folder: "src/application",
    subfolders: ["ports/in", "ports/out", "use-cases"],
  },
  infrastructure: {
    folder: "src/infrastructure",
    subfolders: ["adapters"],
  },
};

const PROTECTED_KEYS = [
  "private",
  "version",
  "license",
  "scripts",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "main",
  "module",
  "types",
  "exports",
  "bin",
];

/**
 * Create a minimal fixture monorepo in a fresh temp directory.
 * Pre-creates bare package dirs for each bounded context name passed.
 *
 * @returns absolute path to the fixture root. Caller is responsible for cleanup.
 */
async function createFixture(boundedContextNames: string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-sync-errors-"));

  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      { name: "fixture-monorepo", private: true, workspaces: ["packages/*"] },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  await fs.writeFile(
    path.join(root, "tsconfig.base.json"),
    JSON.stringify({}, null, 2) + "\n",
    "utf8",
  );

  for (const name of boundedContextNames) {
    await fs.mkdir(path.join(root, "packages", name), { recursive: true });
  }

  return root;
}

async function removeFixture(root: string | null): Promise<void> {
  if (!root) return;
  await fs.rm(root, { recursive: true, force: true });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function makeValidManifest(contexts: Manifest["bounded_contexts"]): Manifest {
  return {
    workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
    generator: {
      sync: {
        layers: LAYERS_TEMPLATE,
        packageJson: { protectedKeys: PROTECTED_KEYS },
      },
    },
    bounded_contexts: contexts,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("SyncEngine — git-check branch logging (external mode)", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it('logs "Skipping git check (external mode)" when mode is "external"', async () => {
    // Covers sync-engine.ts:306-307 — the else-if branch that runs whenever
    // mode !== "self-regen". Pre-requisite for several other error tests, so
    // we pin it explicitly here so a regression surfaces in isolation.
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
    });

    await engine.run();

    const infos = messagesAt(logger, "info");
    assert.ok(
      infos.some((m) => m === "Skipping git check (external mode)"),
      `expected "Skipping git check (external mode)" in info log. Got: ${JSON.stringify(infos)}`,
    );
    // And conversely — no "Git working tree is dirty" error should appear.
    assert.ok(
      !messagesAt(logger, "error").some((m) =>
        m.includes("Git working tree is dirty"),
      ),
      "external mode must not emit git-dirty error",
    );
  });
});

describe("SyncEngine — invalid manifest", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("logs the duplicate-context error and does NOT run rollback in dry-run", async () => {
    // Covers sync-engine.ts:127-134 (validateManifest duplicate detection)
    // and sync-engine.ts:376-390 (catch-block dry-run short-circuit).
    //
    // In dry-run the catch block at line 380 bypasses both the rollback
    // execAsync AND the process.exit(1) call. The engine's promise
    // therefore RESOLVES (does not reject) — we assert on the error log
    // instead of `assert.rejects`.
    fixtureRoot = await createFixture(["shared"]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      manifest: makeValidManifest([
        { name: "shared", type: "shared-kernel" },
        { name: "shared", type: "core" },
      ]),
    });

    await engine.run();

    const errors = messagesAt(logger, "error");
    assert.ok(
      errors.some(
        (m) =>
          m.includes("Sync failed") &&
          m.includes("duplicate bounded context names") &&
          m.includes("shared"),
      ),
      `expected duplicate-context error in error log. Got: ${JSON.stringify(errors)}`,
    );
  });

  it('warns about "missing type field" but completes sync when a context omits `type`', async () => {
    // Covers sync-engine.ts:141-143 — a missing `type` is a warning, not an
    // abort. Sync should process the module and write (or report in dry-run)
    // the expected artifacts.
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      // `type` intentionally omitted — BoundedContext.type is optional at the
      // type level; validateManifest warns at runtime when the field is
      // missing (sync-engine.ts:141-143).
      manifest: makeValidManifest([{ name: "alpha" }]),
    });

    await engine.run();

    const warns = messagesAt(logger, "warn");
    assert.ok(
      warns.some(
        (m) => m.includes('"alpha"') && m.includes("missing type field"),
      ),
      `expected "missing type field" warning. Got: ${JSON.stringify(warns)}`,
    );

    // Sanity: sync did not bail — the completion banner should be present.
    const infos = messagesAt(logger, "info");
    assert.ok(
      infos.some((m) => m.includes("Sync completed successfully")),
      "sync should complete after a non-fatal warning",
    );
    // And no error was logged.
    assert.deepEqual(
      messagesAt(logger, "error"),
      [],
      "missing-type should warn, never error",
    );
  });
});

describe("SyncEngine — manifest-on-disk absent", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("warns and synthesizes empty manifest in dry-run when file is absent", async () => {
    // Covers sync-engine.ts:97-109 (ENOENT + dryRun → empty manifest).
    //
    // The fixture has NO `.architecture/manifest.yaml` and we do NOT pass
    // `options.manifest`, so loadManifest() must hit the file-system path
    // and handle the ENOENT gracefully.
    fixtureRoot = await createFixture([]);
    const logger = createSpyLogger();

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      // manifest option deliberately omitted
    });

    await engine.run();

    const warns = messagesAt(logger, "warn");
    assert.ok(
      warns.some((m) =>
        m.includes("Manifest not found — using empty for dry-run"),
      ),
      `expected dry-run empty-manifest warning. Got: ${JSON.stringify(warns)}`,
    );
    assert.ok(
      messagesAt(logger, "info").some((m) =>
        m.includes("Sync completed successfully"),
      ),
      "dry-run with empty manifest must complete successfully",
    );
    assert.deepEqual(
      messagesAt(logger, "error"),
      [],
      "missing manifest in dry-run must not produce error-level logs",
    );
  });
});

describe("SyncEngine — path-traversal defense (dry-run)", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("skips bounded contexts whose name would escape the packages directory", async () => {
    // Covers sync-engine.ts:166-176 (ensureDirectories guard) and
    // sync-engine.ts:213-222 (generateCoreArtifacts guard). The guards
    // must reject any name containing "..", "/", or starting with ".".
    //
    // Crucially: nothing should be created outside `<fixture>/packages/` —
    // verified below by asserting the evil path does NOT exist on disk.
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();

    // Three evil names exercising each guard condition.
    const evilNames = ["../../etc/passwd", "foo/bar", ".hidden"];
    const manifest = makeValidManifest([
      { name: "alpha", type: "core" },
      ...evilNames.map((n) => ({ name: n, type: "core" as const })),
    ]);

    const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
      targetRoot: fixtureRoot,
      manifest,
    });

    await engine.run();

    // Each evil name must produce a warning from BOTH guards
    // (ensureDirectories warns, then generateCoreArtifacts warns again).
    const warns = messagesAt(logger, "warn");
    for (const evil of evilNames) {
      const hits = warns.filter(
        (m) => m.includes("Skipping invalid module name") && m.includes(evil),
      );
      assert.ok(
        hits.length >= 1,
        `expected path-traversal warning for ${JSON.stringify(evil)}. Got warnings: ${JSON.stringify(warns)}`,
      );
    }

    // And nothing evil must have been materialized (dry-run anyway, but
    // the guard also needs to have short-circuited `ensureLayerFolders`).
    // We check the fixture's packages dir contains ONLY the expected "alpha".
    const pkgDir = path.join(fixtureRoot, "packages");
    const entries = await fs.readdir(pkgDir);
    assert.deepEqual(
      entries.sort(),
      ["alpha"],
      `packages/ must contain only legitimate contexts. Got: ${JSON.stringify(entries)}`,
    );

    // Defense-in-depth: the target of a `..` escape must not exist either.
    // We resolve what the *unguarded* path would have been and assert absence.
    const escapedDir = path.resolve(
      fixtureRoot,
      "packages",
      "../../etc/passwd",
    );
    assert.equal(
      await pathExists(escapedDir),
      false,
      `path-traversal target must NOT exist: ${escapedDir}`,
    );

    // Sync must still complete — the guards are warnings, not aborts.
    assert.ok(
      messagesAt(logger, "info").some((m) =>
        m.includes("Sync completed successfully"),
      ),
    );
  });
});

describe("SyncEngine — dry-run failure does NOT invoke rollback", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("does not call process.exit and does not mutate the fixture on forced failure", async () => {
    // Covers sync-engine.ts:380 (`if (!dryRun)` gate around the rollback +
    // process.exit(1)). With dryRun:true the entire rollback branch is
    // skipped, so process.exit must never fire and the fixture tree must
    // be unchanged by the error path.
    //
    // The forced failure is a duplicate-name manifest, same trigger used
    // by the invalid-manifest suite above but with an explicit process.exit
    // spy wrapping the run.
    fixtureRoot = await createFixture(["dup"]);
    const logger = createSpyLogger();

    // Snapshot fixture BEFORE run so we can verify nothing changed.
    const before = (await fs.readdir(fixtureRoot)).sort();

    // Spy on process.exit — if ANY test in this file reaches line 389
    // of sync-engine.ts, this throw surfaces as a test failure with a
    // clear message. Restored in finally.
    const originalExit = process.exit;
    const exitCalls: Array<number | undefined> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = ((code?: number) => {
      exitCalls.push(code);
      throw new Error(
        `process.exit(${code}) was called — dry-run must skip rollback`,
      );
    }) as never;

    try {
      const engine = new SyncEngine(makeExternalDryRunFlags({ logger }), {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([
          { name: "dup", type: "core" },
          { name: "dup", type: "shared-kernel" },
        ]),
      });

      await engine.run();

      assert.deepEqual(
        exitCalls,
        [],
        "process.exit must NOT be called in dry-run failure path",
      );

      // Error WAS logged (failure still reported via logger.error)...
      assert.ok(
        messagesAt(logger, "error").some((m) => m.includes("Sync failed")),
        "dry-run failure still logs Sync failed",
      );
      // ...but no "Rollback completed" info line should appear, because
      // the rollback branch was gated off.
      assert.ok(
        !messagesAt(logger, "info").some((m) =>
          m.includes("Rollback completed"),
        ),
        "rollback must not be attempted in dry-run",
      );

      // Fixture root contents unchanged (only the original `packages/` +
      // `package.json` + `tsconfig.base.json`).
      const after = (await fs.readdir(fixtureRoot)).sort();
      assert.deepEqual(
        after,
        before,
        "dry-run failure must leave the fixture tree untouched",
      );
    } finally {
      process.exit = originalExit;
    }
  });
});

// =============================================================================
// SELF-REGEN TESTS — newly enabled by the cwd bug-fix in SyncEngine.run()
//
// Background: SyncEngine.run() previously called
//   execAsync("git status --porcelain")      // line ~284
//   execAsync("git reset --hard HEAD && git clean -fd")  // line ~382 (rollback)
// without a `cwd` option, meaning they operated on `process.cwd()` — which in
// a test context is the host monorepo. The rollback command is destructive
// (it would wipe the host working tree on any self-regen failure).
//
// The fix pins the first call to `this.options?.targetRoot ?? process.cwd()`
// and the second to `this.workspaceRoot`. Both now target the fixture when
// `options.targetRoot` is passed in, making the following tests safe to run.
//
// EVERY test in this block:
//   1. Creates a real git repo in a temp dir via `makeFixtureRepo`.
//   2. Passes `targetRoot: fixtureRoot` so the engine operates on the fixture.
//   3. Snapshots `hostRepoGitStatus()` before and asserts equality after.
//      If the fix regresses, this assertion is the tripwire.
//   4. Mocks `process.exit` for any path that reaches the rollback (non-dry-run
//      failure), because the engine ends the rollback branch with
//      `process.exit(1)` which would terminate the test runner.
//
// Cross-reference: the existing "SyncEngine — git-check branch logging
// (external mode)" block above proves that external+dry-run paths never touch
// git; this block proves the self-regen paths only touch the fixture.
// =============================================================================

describe("SyncEngine — self-regen git-check (fixture-only)", () => {
  let fixtureRoot: string | null = null;
  let hostStatusBefore = "";

  afterEach(async () => {
    const hostStatusAfter = hostRepoGitStatus();
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
    assert.equal(
      hostStatusAfter,
      hostStatusBefore,
      "host repo git status must be byte-identical after test",
    );
  });

  it("#1 aborts with 'Dirty git tree' when fixture has uncommitted changes (allowDirty:false)", async () => {
    // Covers the happy-path of the new cwd fix: `git status --porcelain`
    // now runs against the fixture, so a dirty fixture trips the check
    // while the host repo remains untouched.
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-git-"),
    );
    await makeFixtureRepo(fixtureRoot);
    // Dirty the fixture: modify a tracked file so `git status` reports change.
    await fs.writeFile(path.join(fixtureRoot, ".gitkeep"), "dirty");

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: false, dryRun: true }),
      {
        targetRoot: fixtureRoot,
        // Provide a manifest so loadManifest doesn't need to hit the disk.
        manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
      },
    );

    await assert.rejects(() => engine.run(), /Dirty git tree/);

    // The error was logged at the engine's own site too (not just thrown).
    assert.ok(
      messagesAt(logger, "error").some((m) =>
        m.includes("Git working tree is dirty"),
      ),
      "engine must log the dirty-tree error before throwing",
    );
  });

  it("#2 with allowDirty:true skips git check and proceeds to a synthetic mid-flight failure", async () => {
    // Covers sync-engine.ts:309 (the --allow-dirty warn branch). We still
    // use dryRun:true so that when validateManifest throws downstream the
    // catch at line 376 short-circuits BEFORE the rollback — otherwise we
    // would run the (now-fixture-targeted) `git reset --hard` and
    // `process.exit(1)`, which is covered by tests #9/#10 below.
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-git-"),
    );
    await makeFixtureRepo(fixtureRoot);
    // Dirty the fixture (would trip allowDirty:false, but we set it true).
    await fs.writeFile(path.join(fixtureRoot, ".gitkeep"), "dirty");

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: true, dryRun: true }),
      {
        targetRoot: fixtureRoot,
        // Synthetic failure injected AFTER the git check passes: duplicate
        // bounded-context names cause validateManifest() to throw.
        manifest: makeValidManifest([
          { name: "dup", type: "core" },
          { name: "dup", type: "shared-kernel" },
        ]),
      },
    );

    // dryRun:true + failure in validateManifest → catch logs error but
    // skips rollback AND does not call process.exit, so run() RESOLVES.
    await engine.run();

    // Assertion 1: the allowDirty warn was emitted — proof the git check
    // was skipped (not that it passed).
    assert.ok(
      messagesAt(logger, "warn").some((m) =>
        m.includes("Skipping git clean check"),
      ),
      "allowDirty:true must log 'Skipping git clean check'",
    );
    // Assertion 2: the synthetic mid-flight failure was reached. Proves
    // we advanced past the git check and into the main try block.
    assert.ok(
      messagesAt(logger, "error").some(
        (m) =>
          m.includes("Sync failed") &&
          m.includes("duplicate bounded context names"),
      ),
      "synthetic failure must surface as a Sync failed error",
    );
  });

  it("#4 throws 'repository not found' when fixture is NOT a git repo", async () => {
    // Covers sync-engine.ts:293-295 — the "not a git repository" branch
    // of the git-check catch. Prior to the cwd fix, the engine would
    // never hit this branch in practice (the host repo is always a git
    // repo, so `git status` there succeeds). The fix now runs the check
    // against the fixture, which deliberately is NOT a git repo here.
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-nogit-"),
    );
    // NB: intentionally NOT calling makeFixtureRepo — no git init.

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: false, dryRun: true }),
      {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
      },
    );

    await assert.rejects(
      () => engine.run(),
      /Git operation failed: repository not found/,
    );
    assert.ok(
      messagesAt(logger, "error").some((m) =>
        m.includes("not a git repository"),
      ),
      "engine must log the not-a-git-repo error before re-throwing",
    );
  });
});

describe("SyncEngine — self-regen lock behaviour (fixture-only)", () => {
  let fixtureRoot: string | null = null;
  let hostStatusBefore = "";

  afterEach(async () => {
    const hostStatusAfter = hostRepoGitStatus();
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
    assert.equal(
      hostStatusAfter,
      hostStatusBefore,
      "host repo git status must be byte-identical after test",
    );
  });

  it("#5 aborts with 'another sync is in progress' when lock is already held", async () => {
    // Covers sync-engine.ts:324-335 — lock contention path. The engine
    // hits the rollback branch (non-dry-run) and calls process.exit(1),
    // both of which must target the FIXTURE only. We acquire a real
    // LockFile against the fixture BEFORE starting the engine.
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-lock-"),
    );
    await makeFixtureRepo(fixtureRoot);
    // LockFile writes to `${workspaceRoot}/.architecture/.sync.lock` —
    // the directory must pre-exist.
    await fs.mkdir(path.join(fixtureRoot, ".architecture"), {
      recursive: true,
    });

    const heldLock = new LockFile(fixtureRoot);
    await heldLock.acquire();

    hostStatusBefore = hostRepoGitStatus();

    try {
      const logger = createSpyLogger();
      const engine = new SyncEngine(
        // non-dry-run + allowDirty so we pass the git check and reach
        // the lock-acquire at line 327.
        makeSelfRegenFlags({ logger, allowDirty: true, dryRun: false }),
        {
          targetRoot: fixtureRoot,
          manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
        },
      );

      await withProcessExitSpy(async (exitCalls) => {
        // The engine's contention throw goes to catch → rollback (now
        // targeting the fixture thanks to the cwd fix) → process.exit(1).
        // Our spy throws on exit, surfacing as the rejection below.
        await assert.rejects(() => engine.run(), /__process_exit_spy__\(1\)/);
        assert.deepEqual(
          exitCalls,
          [1],
          "engine must terminate with process.exit(1) after contention",
        );
      });

      assert.ok(
        messagesAt(logger, "error").some((m) =>
          m.includes("Sync aborted: another sync is in progress"),
        ),
        "engine must log the contention error",
      );
    } finally {
      // Release the manually held lock so afterEach can remove the fixture.
      await heldLock.forceRelease();
    }
  });

  it("#7 leaves no lock file on disk after a failure (validateManifest throws pre-acquire)", async () => {
    // Covers sync-engine.ts:391-400 (finally-block release) from the
    // "no orphan lock file" angle. NB: because validateManifest() is at
    // line 315 and LockFile.acquire() is at line 327, a duplicate-context
    // manifest fails BEFORE the lock is acquired. The finally block
    // therefore sees `lockFile === null` and skips release — but the
    // post-condition ("no lock file on disk") still holds, trivially,
    // because the lock was never created. This test pins the post-
    // condition regardless of WHICH branch in the finally produces it.
    //
    // The more interesting "lock acquired THEN released on later failure"
    // would require a post-acquire injection point; see "skipped tests"
    // notes in the PR summary for #6.
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-lock-"),
    );
    await makeFixtureRepo(fixtureRoot);
    await fs.mkdir(path.join(fixtureRoot, ".architecture"), {
      recursive: true,
    });

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: true, dryRun: false }),
      {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([
          { name: "dup", type: "core" },
          { name: "dup", type: "shared-kernel" },
        ]),
      },
    );

    await withProcessExitSpy(async (exitCalls) => {
      await assert.rejects(() => engine.run(), /__process_exit_spy__\(1\)/);
      assert.deepEqual(
        exitCalls,
        [1],
        "engine must exit(1) after invalid-manifest failure in non-dry-run",
      );
    });

    // The key post-condition: no orphan lock file left behind.
    const lockPath = path.join(fixtureRoot, ".architecture", ".sync.lock");
    assert.equal(
      await pathExists(lockPath),
      false,
      "no .sync.lock file may remain on disk after failure",
    );
  });
});

describe("SyncEngine — self-regen rollback + process.exit (fixture-only)", () => {
  let fixtureRoot: string | null = null;
  let hostStatusBefore = "";

  afterEach(async () => {
    const hostStatusAfter = hostRepoGitStatus();
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
    assert.equal(
      hostStatusAfter,
      hostStatusBefore,
      "host repo git status must be byte-identical after test",
    );
  });

  it("#9 rollback runs 'git reset --hard HEAD && git clean -fd' against the FIXTURE, not the host", async () => {
    // THE canonical regression test for the cwd bug. Prior to the fix,
    // a non-dry-run self-regen failure would reset+clean the host repo
    // (because execAsync had no cwd). The fix pins cwd to
    // `this.workspaceRoot`, which — with `targetRoot: fixtureRoot` —
    // resolves to the fixture. We verify by:
    //   (a) Confirming the fixture's uncommitted change is GONE after
    //       the run (proof the reset ran).
    //   (b) Confirming the host repo git status is UNCHANGED (proof the
    //       reset did NOT run against the host).
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-rollback-"),
    );
    await makeFixtureRepo(fixtureRoot);
    // Uncommitted change on a tracked file — will be wiped by the rollback.
    await fs.writeFile(
      path.join(fixtureRoot, ".gitkeep"),
      "UNCOMMITTED_CHANGE_PATTERN",
    );
    // Sanity pre-condition: fixture is dirty.
    const fixtureDirtyBefore = execSync("git status --porcelain", {
      cwd: fixtureRoot,
      encoding: "utf8",
    });
    assert.ok(
      fixtureDirtyBefore.length > 0,
      "fixture must be dirty before the run (precondition for this test)",
    );

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      // allowDirty:true so the git check does not abort early — we want
      // the failure to come from validateManifest so the rollback fires.
      makeSelfRegenFlags({ logger, allowDirty: true, dryRun: false }),
      {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([
          { name: "dup", type: "core" },
          { name: "dup", type: "shared-kernel" },
        ]),
      },
    );

    await withProcessExitSpy(async () => {
      await assert.rejects(() => engine.run(), /__process_exit_spy__\(1\)/);
    });

    // (a) Rollback ran against the fixture → fixture is now clean.
    const fixtureStatusAfter = execSync("git status --porcelain", {
      cwd: fixtureRoot,
      encoding: "utf8",
    });
    assert.equal(
      fixtureStatusAfter,
      "",
      "rollback must have wiped the fixture's uncommitted changes",
    );
    // And the file contents match HEAD (empty, per makeFixtureRepo).
    const keepContent = await fs.readFile(
      path.join(fixtureRoot, ".gitkeep"),
      "utf8",
    );
    assert.equal(
      keepContent,
      "",
      "rollback must have restored .gitkeep to its HEAD (empty) state",
    );
    // Rollback completion was logged.
    assert.ok(
      messagesAt(logger, "info").some((m) => m.includes("Rollback completed")),
      "engine must log 'Rollback completed' after a successful rollback",
    );

    // (b) Host repo git status is unchanged — verified by afterEach.
  });

  it("#10 calls process.exit(1) on non-dry-run failure", async () => {
    // Covers sync-engine.ts:389 — the hard exit after rollback. This is
    // a narrower sibling of #9 that focuses on the exit-code contract.
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-exit-"),
    );
    await makeFixtureRepo(fixtureRoot);

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: true, dryRun: false }),
      {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([
          { name: "dup", type: "core" },
          { name: "dup", type: "shared-kernel" },
        ]),
      },
    );

    await withProcessExitSpy(async (exitCalls) => {
      await assert.rejects(() => engine.run(), /__process_exit_spy__\(1\)/);
      assert.deepEqual(
        exitCalls,
        [1],
        "process.exit must be called exactly once with code 1",
      );
    });
  });

  it("#14 throws in non-dry-run when manifest file is absent (ENOENT → rollback)", async () => {
    // Covers sync-engine.ts:97-109 from the OPPOSITE end of #3-absent
    // (which exercised the dryRun branch). In non-dry-run, the ENOENT
    // from fs.access re-throws, lands in the catch (line 376), and
    // triggers the rollback + process.exit(1). The rollback MUST run
    // against the fixture (cwd fix) so the host stays clean.
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-nomanifest-"),
    );
    await makeFixtureRepo(fixtureRoot);
    // Deliberately DO NOT pass `options.manifest`, and DO NOT create
    // `.architecture/manifest.yaml`. loadManifest() will hit fs.access,
    // get ENOENT, and (because dryRun:false) re-throw.

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: true, dryRun: false }),
      {
        targetRoot: fixtureRoot,
        // manifest option intentionally omitted
      },
    );

    await withProcessExitSpy(async (exitCalls) => {
      await assert.rejects(() => engine.run(), /__process_exit_spy__\(1\)/);
      assert.deepEqual(exitCalls, [1]);
    });

    // The underlying ENOENT surfaced through the catch as a Sync failed log.
    assert.ok(
      messagesAt(logger, "error").some(
        (m) => m.includes("Sync failed") && m.includes("ENOENT"),
      ),
      "engine must log the ENOENT failure on missing manifest",
    );
    // Rollback completed log — proves the rollback branch fired AND
    // targeted the fixture (otherwise afterEach's host-status check would
    // have blown up).
    assert.ok(
      messagesAt(logger, "info").some((m) => m.includes("Rollback completed")),
      "rollback must complete against the fixture on ENOENT failure",
    );
  });
});
