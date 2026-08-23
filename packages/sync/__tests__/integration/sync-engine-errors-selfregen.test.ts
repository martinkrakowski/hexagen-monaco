import assert from "node:assert/strict";
import { describe, it, afterEach } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SyncEngine } from "../../src/sync-engine.js";
import { LockFile } from "../../src/lock.js";
import { createSpyLogger, messagesAt } from "../helpers/spy-logger.js";
import {
  removeFixture,
  makeValidManifest,
} from "../helpers/fixture-factory.js";
import { pathExists } from "../helpers/fs-helpers.js";
import { makeSelfRegenFlags } from "../helpers/test-config.js";
import { SKIP_NON_POSIX } from "../helpers/published-layout.js";

function locateHostRepoRoot(): string {
  // fileURLToPath, not URL.pathname: on win32 the pathname is an undecoded
  // "/D:/..." drive-relative string that no cwd accepts.
  let dir = path.dirname(fileURLToPath(import.meta.url));
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
  gitCheckoutMainQuietly(tmpDir);
  await fs.writeFile(path.join(tmpDir, ".gitkeep"), "");
  execSync("git add .", { cwd: tmpDir });
  execSync('git commit -m "init" --quiet', { cwd: tmpDir });
}

function gitCheckoutMainQuietly(tmpDir: string): void {
  // No shell string: "2>/dev/null || true" is POSIX-only under cmd.exe. But a
  // blanket catch would also swallow REAL failures (a main ref that already
  // exists, a corrupt HEAD, git missing from PATH), leaving the fixture on
  // whatever branch `git init` picked while the tests still pass. Tolerate
  // only the verified benign outcome — HEAD already resolves to main
  // (unborn via init.defaultBranch=main, or checked out) — and fail the
  // setup loudly on anything else.
  try {
    execFileSync("git", ["checkout", "-b", "main", "--quiet"], {
      cwd: tmpDir,
      stdio: "ignore",
    });
  } catch {
    let currentBranch: string | null = null;
    try {
      currentBranch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd: tmpDir,
        encoding: "utf8",
      }).trim();
    } catch {
      // Unreadable or detached HEAD — never benign for a fresh fixture.
    }
    if (currentBranch !== "main") {
      throw new Error(
        `gitCheckoutMainQuietly: 'git checkout -b main' failed and HEAD is ${
          currentBranch ?? "unreadable"
        } — refusing to continue the fixture on an unexpected branch`,
      );
    }
  }
}

describe("gitCheckoutMainQuietly (fixture helper)", () => {
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

  it("#g1 tolerates an unborn HEAD already on main (init.defaultBranch=main)", async () => {
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-checkout-benign-"),
    );
    execSync("git init --quiet -b main", { cwd: fixtureRoot });
    hostStatusBefore = hostRepoGitStatus();

    // `git checkout -b main` on an unborn main succeeds on modern git, but
    // some environments fail it benignly — either way HEAD must end on main
    // and the helper must not throw.
    gitCheckoutMainQuietly(fixtureRoot);
    assert.equal(
      execSync("git symbolic-ref --short HEAD", {
        cwd: fixtureRoot,
        encoding: "utf8",
      }).trim(),
      "main",
    );
  });

  it("#g2 throws loudly when checkout fails for a non-benign reason (existing main, HEAD elsewhere)", async () => {
    fixtureRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-sync-checkout-loud-"),
    );
    execSync("git init --quiet -b master", { cwd: fixtureRoot });
    execSync('git config user.name "test"', { cwd: fixtureRoot });
    execSync('git config user.email "test@test"', { cwd: fixtureRoot });
    await fs.writeFile(path.join(fixtureRoot, ".gitkeep"), "");
    execSync("git add .", { cwd: fixtureRoot });
    execSync('git commit -m "init" --quiet', { cwd: fixtureRoot });
    // refs/heads/main now exists while HEAD is on master, so
    // `git checkout -b main` fails with "a branch named 'main' already
    // exists" — an unexpected failure the helper must surface, not swallow.
    execSync("git branch main", { cwd: fixtureRoot });
    hostStatusBefore = hostRepoGitStatus();
    const root = fixtureRoot;

    assert.throws(
      () => gitCheckoutMainQuietly(root),
      /gitCheckoutMainQuietly.*failed.*unexpected branch/s,
    );
  });
});

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

    // The thrown message is what the CLI surfaces as "Fatal sync error: ..."
    // (F20) — it must itself carry the --allow-dirty hint, not rely on the
    // logger line being shown.
    await assert.rejects(() => engine.run(), /Dirty git tree.*--allow-dirty/);

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

  it("#9 NEVER rolls back under --allow-dirty — uncommitted changes survive a failed run (PR-B1, RCA #4)", async () => {
    // Pre-B1 this exact scenario pinned the data-loss bug: the engine ran
    // `git reset --hard HEAD && git clean -fd` against the whole tree even
    // under --allow-dirty and even when the failure happened BEFORE any
    // write, wiping .gitkeep's uncommitted content. B1 inverts it: the
    // failure here (validateManifest) fires pre-write, so the journal is
    // empty and the tree must be left byte-identical.
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
      fixtureDirtyBefore,
      "the fixture's git status must be untouched — no reset, no clean",
    );
    const keepContent = await fs.readFile(
      path.join(fixtureRoot, ".gitkeep"),
      "utf8",
    );
    assert.equal(
      keepContent,
      "UNCOMMITTED_CHANGE_PATTERN",
      "the user's uncommitted change must SURVIVE the failed run",
    );
    assert.ok(
      messagesAt(logger, "info").some((m) =>
        m.includes("No files were touched before the failure"),
      ),
      "pre-write failure must report an empty journal",
    );
    assert.ok(
      !messagesAt(logger, "info").some((m) => m.includes("Rollback completed")),
      "no rollback may run when nothing was journaled",
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

  it("#14 throws in non-dry-run when manifest file is absent (ENOENT → empty journal, nothing to roll back)", async () => {
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
    // loadManifest fails before any write — the journal is empty, so there
    // is nothing to roll back (and under --allow-dirty we never would).
    assert.ok(
      messagesAt(logger, "info").some((m) =>
        m.includes("No files were touched before the failure"),
      ),
      "ENOENT fires pre-write — the engine must report an empty journal",
    );
    assert.ok(
      !messagesAt(logger, "info").some((m) => m.includes("Rollback completed")),
      "no rollback may run when nothing was journaled",
    );
  });
});

/**
 * Stale-but-parseable seed for `packages/alpha/package.json` (committed by
 * the fixture). generatePackageJson MERGES it (protected keys kept, missing
 * keys injected) and writes via safeWriteFileAtomic with skipGeneratedCheck,
 * so mid-run the file is OVERWRITTEN and its pre-image journaled. Rollback
 * must restore these exact bytes. Without an overwrite entry every arc in
 * these fixtures is create→unlink, and a regression that journals null
 * pre-images for updates — which makes rollback DELETE the user's file —
 * passes the whole suite (proven by mutation test, PR-B1 review).
 */
const STALE_ALPHA_PKG =
  '{\n  "name": "@acme/alpha",\n  "version": "0.0.1"\n}\n';

/**
 * Fixture for mid-run failure: the engine must get PAST the early gates
 * (git check, lock, preflight) and write real files before failing, so the
 * journal is non-empty.
 *
 * - Sabotage: `packages/beta/package.json` is a committed DIRECTORY, so
 *   generatePackageJson's pre-read throws EISDIR deterministically — and
 *   only after alpha's artifacts have all landed (modules are processed
 *   sequentially in manifest order).
 * - Seeded overwrite: alpha's committed stale package.json (above) makes the
 *   journal carry an UPDATE entry with a real pre-image, not just creates.
 * - Preflight: self-regen real runs exec `npx turbo run build` with
 *   cwd=workspaceRoot; npx resolves the local node_modules/.bin first, so a
 *   stub `turbo` keeps the run offline and instant. node_modules/ is in the
 *   committed .gitignore so the stub stays porcelain-invisible.
 * - `.architecture/` exists (the lock file lives there) but is an EMPTY,
 *   uncommitted dir — invisible to porcelain, so the clean-tree check
 *   still passes for the no-allow-dirty case.
 */
async function makeMidRunFailureFixture(tmpDir: string): Promise<void> {
  execSync("git init --quiet", { cwd: tmpDir });
  execSync('git config user.name "test"', { cwd: tmpDir });
  execSync('git config user.email "test@test"', { cwd: tmpDir });
  gitCheckoutMainQuietly(tmpDir);
  await fs.writeFile(path.join(tmpDir, ".gitkeep"), "");
  await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules/\n");
  await fs.mkdir(path.join(tmpDir, "packages", "beta", "package.json"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(tmpDir, "packages", "beta", "package.json", "placeholder"),
    "",
  );
  await fs.mkdir(path.join(tmpDir, "packages", "alpha"), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, "packages", "alpha", "package.json"),
    STALE_ALPHA_PKG,
  );
  execSync("git add .", { cwd: tmpDir });
  execSync('git commit -m "init" --quiet', { cwd: tmpDir });

  const binDir = path.join(tmpDir, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, "turbo"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  await fs.mkdir(path.join(tmpDir, ".architecture"), { recursive: true });
}

// POSIX-only, like the contract suites and for the same reason: the fixture's
// preflight stub is a sh-shebang script that cannot exec on win32 — there the
// run would die at preflight, before any journal entry, so nothing this
// describe asserts (EISDIR arc, journal prints, POSIX-separator paths from
// path.relative) is reachable. Declaring that beats separator-tolerant
// regexes that would pretend at a Windows support the stub forecloses.
describe(
  "SyncEngine — journaled rollback after mid-run writes (PR-B1, RCA #4, fixture-only)",
  { skip: SKIP_NON_POSIX },
  () => {
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

    it("#15 rolls back ONLY journaled paths via inverse ops on a clean tree (no --allow-dirty)", async () => {
      fixtureRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "hexagen-sync-rollback-clean-"),
      );
      await makeMidRunFailureFixture(fixtureRoot);

      const cleanBefore = execSync("git status --porcelain", {
        cwd: fixtureRoot,
        encoding: "utf8",
      });
      assert.equal(
        cleanBefore,
        "",
        "fixture must be porcelain-clean before the run (precondition: the git check must pass)",
      );

      hostStatusBefore = hostRepoGitStatus();

      const logger = createSpyLogger();
      const engine = new SyncEngine(
        makeSelfRegenFlags({ logger, allowDirty: false, dryRun: false }),
        {
          targetRoot: fixtureRoot,
          manifest: makeValidManifest([
            { name: "alpha", type: "core" },
            { name: "beta", type: "core" },
          ]),
        },
      );

      await withProcessExitSpy(async (exitCalls) => {
        // macOS and Linux both phrase it "EISDIR: illegal operation on a directory".
        await assert.rejects(
          () => engine.run(),
          /EISDIR|illegal operation on a directory/,
        );
        assert.deepEqual(exitCalls, []);
      });

      // Every file mutation was journaled and inverted; what remains is only
      // empty directories, which porcelain cannot see.
      const statusAfter = execSync("git status --porcelain", {
        cwd: fixtureRoot,
        encoding: "utf8",
      });
      assert.equal(
        statusAfter,
        "",
        "after rollback the tree must be porcelain-clean — every journaled write inverted",
      );
      // The seeded OVERWRITE must be restored byte-identically — this is the
      // assertion that dies if recordWrite ever journals null pre-images for
      // updates (rollback would unlink the user's file instead of restoring it).
      assert.equal(
        await fs.readFile(
          path.join(fixtureRoot, "packages", "alpha", "package.json"),
          "utf8",
        ),
        STALE_ALPHA_PKG,
        "alpha's seeded package.json must be restored to its exact pre-sync bytes",
      );
      assert.equal(
        await pathExists(
          path.join(fixtureRoot, "packages", "alpha", "tsconfig.json"),
        ),
        false,
        "alpha's freshly created tsconfig.json must be unlinked by the rollback",
      );
      assert.ok(
        messagesAt(logger, "info").some((m) =>
          /Rolling back [1-9]\d* journaled path/.test(m),
        ),
        "engine must announce a non-empty journaled rollback",
      );
      assert.ok(
        // Back-reference pins restored === attempted, not just any N/M.
        messagesAt(logger, "info").some((m) =>
          /Rollback completed: (\d+)\/\1 path\(s\) restored/.test(m),
        ),
        "rollback must complete with zero failures (the completed line only prints on the no-failure branch)",
      );
    });

    it("#16 NEVER rolls back under --allow-dirty after mid-run writes — journal printed, tree left as-is", async () => {
      fixtureRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "hexagen-sync-rollback-dirty-"),
      );
      await makeMidRunFailureFixture(fixtureRoot);

      // The user's in-flight work: a dirty tracked file and an untracked
      // scratch file. Pre-B1, `git reset --hard && git clean -fd` destroyed
      // BOTH (clean -fd deletes untracked files sync never touched).
      await fs.writeFile(
        path.join(fixtureRoot, ".gitkeep"),
        "UNCOMMITTED_CHANGE_PATTERN",
      );
      await fs.writeFile(
        path.join(fixtureRoot, "scratch.txt"),
        "user scratch — must survive\n",
      );

      hostStatusBefore = hostRepoGitStatus();

      const logger = createSpyLogger();
      const engine = new SyncEngine(
        makeSelfRegenFlags({ logger, allowDirty: true, dryRun: false }),
        {
          targetRoot: fixtureRoot,
          manifest: makeValidManifest([
            { name: "alpha", type: "core" },
            { name: "beta", type: "core" },
          ]),
        },
      );

      await withProcessExitSpy(async (exitCalls) => {
        await assert.rejects(
          () => engine.run(),
          /EISDIR|illegal operation on a directory/,
        );
        assert.deepEqual(exitCalls, []);
      });

      assert.equal(
        await fs.readFile(path.join(fixtureRoot, "scratch.txt"), "utf8"),
        "user scratch — must survive\n",
        "the untracked scratch file must survive byte-identically (clean -fd would have deleted it)",
      );
      assert.equal(
        await fs.readFile(path.join(fixtureRoot, ".gitkeep"), "utf8"),
        "UNCOMMITTED_CHANGE_PATTERN",
        "the dirty tracked file must keep the user's uncommitted content",
      );
      assert.notEqual(
        await fs.readFile(
          path.join(fixtureRoot, "packages", "alpha", "package.json"),
          "utf8",
        ),
        STALE_ALPHA_PKG,
        "sync's own overwrite stays in place too — under --allow-dirty NOTHING is reverted, not even back to the seed",
      );
      assert.ok(
        // Pins the non-empty-journal branch: a non-zero touched count must be
        // reported (the empty-journal branch says "nothing to roll back" instead).
        messagesAt(logger, "warn").some((m) =>
          /Sync failed after touching [1-9]\d* path\(s\) — NO rollback under --allow-dirty/.test(
            m,
          ),
        ),
        "engine must state that it deliberately did not roll back, with a non-zero touched count",
      );
      assert.ok(
        messagesAt(logger, "warn").some((m) =>
          /packages\/alpha\/package\.json/.test(m),
        ),
        "the printed journal must name the touched paths (alpha's package.json)",
      );
      assert.ok(
        messagesAt(logger, "warn").some((m) =>
          /packages\/alpha\/tsconfig\.json/.test(m),
        ),
        "the printed journal must name alpha's created tsconfig — #15's unlink assert relies on this being a real create→unlink arc",
      );
    });
  },
);
