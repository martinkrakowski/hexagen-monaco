import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import { LockFile } from "../../src/lock.js";
import { createSpyLogger, messagesAt } from "../helpers/spy-logger.js";
import {
  removeFixture,
  makeValidManifest,
} from "../helpers/fixture-factory.js";
import { pathExists } from "../helpers/fs-helpers.js";
import { makeSelfRegenFlags } from "../helpers/test-config.js";

function locateHostRepoRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  while (dir !== path.parse(dir).root) {
    try {
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

async function makeFixtureRepo(tmpDir: string): Promise<void> {
  execSync("git init --quiet", { cwd: tmpDir });
  execSync('git config user.name "test"', { cwd: tmpDir });
  execSync('git config user.email "test@test"', { cwd: tmpDir });
  execSync("git checkout -b main --quiet 2>/dev/null || true", {
    cwd: tmpDir,
  });
  await fs.writeFile(path.join(tmpDir, ".gitkeep"), "");
  execSync("git add .", { cwd: tmpDir });
  execSync('git commit -m "init" --quiet', { cwd: tmpDir });
}

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
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-git-"),
    );
    await makeFixtureRepo(fixtureRoot);
    await fs.writeFile(path.join(fixtureRoot, ".gitkeep"), "dirty");

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: false, dryRun: true }),
      {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
      },
    );

    await assert.rejects(() => engine.run(), /Dirty git tree/);

    assert.ok(
      messagesAt(logger, "error").some((m) =>
        m.includes("Git working tree is dirty"),
      ),
      "engine must log the dirty-tree error before throwing",
    );
  });

  it("#2 with allowDirty:true skips git check; a synthetic mid-flight failure rejects (dry-run must not swallow)", async () => {
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-git-"),
    );
    await makeFixtureRepo(fixtureRoot);
    await fs.writeFile(path.join(fixtureRoot, ".gitkeep"), "dirty");

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: true, dryRun: true }),
      {
        targetRoot: fixtureRoot,
        manifest: makeValidManifest([
          { name: "dup", type: "core" },
          { name: "dup", type: "shared-kernel" },
        ]),
      },
    );

    // Pre-A1 the engine resolved here and the CLI exited 0 — the RCA #2 bug.
    await assert.rejects(() => engine.run(), /duplicate bounded context names/);

    assert.ok(
      messagesAt(logger, "warn").some((m) =>
        m.includes("Skipping git clean check"),
      ),
      "allowDirty:true must log 'Skipping git clean check'",
    );
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
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-nogit-"),
    );

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
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-lock-"),
    );
    await makeFixtureRepo(fixtureRoot);
    await fs.mkdir(path.join(fixtureRoot, ".architecture"), {
      recursive: true,
    });

    const heldLock = new LockFile(fixtureRoot);
    await heldLock.acquire();

    hostStatusBefore = hostRepoGitStatus();

    try {
      const logger = createSpyLogger();
      const engine = new SyncEngine(
        makeSelfRegenFlags({ logger, allowDirty: true, dryRun: false }),
        {
          targetRoot: fixtureRoot,
          manifest: makeValidManifest([{ name: "alpha", type: "core" }]),
        },
      );

      await withProcessExitSpy(async (exitCalls) => {
        await assert.rejects(() => engine.run(), /another sync is in progress/);
        assert.deepEqual(
          exitCalls,
          [],
          "engine must NOT call process.exit — exit codes belong to the CLI layer",
        );
      });

      assert.ok(
        messagesAt(logger, "error").some((m) =>
          m.includes("Sync aborted: another sync is in progress"),
        ),
        "engine must log the contention error",
      );
    } finally {
      await heldLock.forceRelease();
    }
  });

  it("#7 leaves no lock file on disk after a failure (validateManifest throws pre-acquire)", async () => {
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
      await assert.rejects(
        () => engine.run(),
        /duplicate bounded context names/,
      );
      assert.deepEqual(
        exitCalls,
        [],
        "invalid-manifest failure must rethrow, not exit in-engine",
      );
    });

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
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-rollback-"),
    );
    await makeFixtureRepo(fixtureRoot);
    await fs.writeFile(
      path.join(fixtureRoot, ".gitkeep"),
      "UNCOMMITTED_CHANGE_PATTERN",
    );
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
      await assert.rejects(
        () => engine.run(),
        /duplicate bounded context names/,
      );
    });

    const fixtureStatusAfter = execSync("git status --porcelain", {
      cwd: fixtureRoot,
      encoding: "utf8",
    });
    assert.equal(
      fixtureStatusAfter,
      "",
      "rollback must have wiped the fixture's uncommitted changes",
    );
    const keepContent = await fs.readFile(
      path.join(fixtureRoot, ".gitkeep"),
      "utf8",
    );
    assert.equal(
      keepContent,
      "",
      "rollback must have restored .gitkeep to its HEAD (empty) state",
    );
    assert.ok(
      messagesAt(logger, "info").some((m) => m.includes("Rollback completed")),
      "engine must log 'Rollback completed' after a successful rollback",
    );
  });

  it("#10 rethrows on non-dry-run failure without calling process.exit (exit codes belong to the CLI layer)", async () => {
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
      await assert.rejects(
        () => engine.run(),
        /duplicate bounded context names/,
      );
      assert.deepEqual(
        exitCalls,
        [],
        "process.exit must never be called by the engine",
      );
    });
  });

  it("#14 throws in non-dry-run when manifest file is absent (ENOENT → rollback)", async () => {
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-errors-nomanifest-"),
    );
    await makeFixtureRepo(fixtureRoot);

    hostStatusBefore = hostRepoGitStatus();

    const logger = createSpyLogger();
    const engine = new SyncEngine(
      makeSelfRegenFlags({ logger, allowDirty: true, dryRun: false }),
      {
        targetRoot: fixtureRoot,
      },
    );

    await withProcessExitSpy(async (exitCalls) => {
      await assert.rejects(
        () => engine.run(),
        /Failed to parse manifest: ENOENT/,
      );
      assert.deepEqual(exitCalls, []);
    });

    assert.ok(
      messagesAt(logger, "error").some(
        (m) => m.includes("Sync failed") && m.includes("ENOENT"),
      ),
      "engine must log the ENOENT failure on missing manifest",
    );
    assert.ok(
      messagesAt(logger, "info").some((m) => m.includes("Rollback completed")),
      "rollback must complete against the fixture on ENOENT failure",
    );
  });
});
