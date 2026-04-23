import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { LockFile } from "../src/lock.js";

/**
 * Unit tests for lock.ts — the LockFile concurrency primitive that prevents
 * concurrent sync corruption.
 *
 * Signature under test (reverse-engineered from src/lock.ts):
 *
 *   const LOCK_FILE = ".architecture/.sync.lock";
 *
 *   class LockFile {
 *     constructor(
 *       workspaceRoot: string,
 *       fsImpl: typeof fs = fs,
 *       logger: typeof console = console,
 *     );
 *     acquire(): Promise<void>;   // throws — no Result type
 *     release(): Promise<void>;   // tolerates unheld / ENOENT
 *     forceRelease(): Promise<void>;  // never throws
 *   }
 *
 * Key observed behaviours documented by these tests:
 *
 *   - Lock file path is `${workspaceRoot}/.architecture/.sync.lock`.
 *   - Acquisition is filesystem-sentinel based: `fs.open(path, "wx")`.
 *     The lock's existence IS the lock; the file is empty (no PID / JSON body).
 *   - Contention: a second `acquire()` (same instance OR cross-instance) throws
 *     an error whose message starts with "Sync already in progress".
 *   - Re-entry on the SAME instance throws "Lock already acquired" (synchronous
 *     guard BEFORE the fs.open call).
 *   - `release()` on an unheld lock logs a warning and returns — it does NOT throw.
 *   - `release()` tolerates ENOENT (external removal) and resets internal state.
 *   - `forceRelease()` never throws — it is the recovery escape hatch.
 *
 * Tests intentionally omitted (no corresponding production logic exists):
 *
 *   - Stale-lock / PID-liveness detection. The lock file has no content,
 *     so there is nothing to inspect. Recovery is manual (delete the file)
 *     or programmatic via `forceRelease()`. See the "design concerns"
 *     section of the PR notes.
 *
 * Concerns discovered (reported, not fixed):
 *
 *   - `acquire()` rethrows non-EEXIST errno errors RAW (e.g., a missing
 *     `.architecture/` directory produces a bare `ENOENT` error, not a
 *     typed domain error). This breaks the AGENTS.md §4 invariant
 *     "catch block returning raw EACCES is a violation" — strictly speaking
 *     acquire doesn't swallow the error (good), but it also doesn't wrap it
 *     as a typed `SyncError` / `Result<void, E>` (inconsistent with the rest
 *     of the sync package). Tests assert the *current* behaviour and call
 *     this out as documentation.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOCK_RELATIVE_PATH = ".architecture/.sync.lock";

interface LogCall {
  level: "debug" | "info" | "warn" | "error" | "log";
  message: string;
}

/**
 * Minimal stand-in for the `typeof console` shape LockFile depends on.
 * Only the methods LockFile actually calls are spied; other methods are
 * no-ops so the shape is structurally compatible.
 */
function createSpyLogger(): typeof console & { calls: LogCall[] } {
  const calls: LogCall[] = [];
  const record =
    (level: LogCall["level"]) =>
    (...args: unknown[]) => {
      calls.push({ level, message: args.map((a) => String(a)).join(" ") });
    };
  // Start from the real console to satisfy the full `typeof console` type,
  // then override the methods we care about.
  const spy = Object.create(console) as typeof console & { calls: LogCall[] };
  spy.calls = calls;
  spy.debug = record("debug");
  spy.info = record("info");
  spy.warn = record("warn");
  spy.error = record("error");
  spy.log = record("log");
  return spy;
}

async function makeTmpWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-lock-test-"));
  // LockFile requires `.architecture/` to exist (it opens a file inside it,
  // not the directory itself). Mirror the real sync bootstrap.
  await fs.mkdir(path.join(root, ".architecture"), { recursive: true });
  return root;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lock-file path
// ---------------------------------------------------------------------------

describe("LockFile — path contract", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await makeTmpWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("writes to `${workspaceRoot}/.architecture/.sync.lock`", async () => {
    const lock = new LockFile(workspaceRoot, fs, createSpyLogger());
    try {
      await lock.acquire();
      const expected = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
      assert.equal(
        await exists(expected),
        true,
        `lock file must be created at ${LOCK_RELATIVE_PATH}`,
      );
    } finally {
      await lock.forceRelease();
    }
  });
});

// ---------------------------------------------------------------------------
// Basic acquisition / release
// ---------------------------------------------------------------------------

describe("LockFile — basic acquisition", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await makeTmpWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("acquire() creates the lock file when not held", async () => {
    const lockPath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
    assert.equal(
      await exists(lockPath),
      false,
      "precondition: lock file must not pre-exist",
    );

    const lock = new LockFile(workspaceRoot, fs, createSpyLogger());
    try {
      await lock.acquire();
      assert.equal(
        await exists(lockPath),
        true,
        "acquire must create the sentinel file",
      );
    } finally {
      await lock.forceRelease();
    }
  });

  it("release() removes the lock file", async () => {
    const lockPath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
    const lock = new LockFile(workspaceRoot, fs, createSpyLogger());

    await lock.acquire();
    assert.equal(await exists(lockPath), true);

    await lock.release();
    assert.equal(
      await exists(lockPath),
      false,
      "release must remove the sentinel file",
    );
  });

  it("lock file is empty (pure filesystem sentinel — no PID, no JSON body)", async () => {
    const lockPath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
    const lock = new LockFile(workspaceRoot, fs, createSpyLogger());

    try {
      await lock.acquire();
      const contents = await fs.readFile(lockPath, "utf8");
      assert.equal(
        contents,
        "",
        "lock file content is empty — its EXISTENCE is the lock",
      );
    } finally {
      await lock.forceRelease();
    }
  });

  it("acquire → release → acquire cycle works", async () => {
    const lockPath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
    const lock = new LockFile(workspaceRoot, fs, createSpyLogger());

    await lock.acquire();
    assert.equal(await exists(lockPath), true);
    await lock.release();
    assert.equal(await exists(lockPath), false);

    // Second acquire on same instance must succeed cleanly.
    await lock.acquire();
    assert.equal(
      await exists(lockPath),
      true,
      "re-acquire after release must re-create the sentinel",
    );
    await lock.release();
  });
});

// ---------------------------------------------------------------------------
// Contention
// ---------------------------------------------------------------------------

describe("LockFile — contention", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await makeTmpWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("re-acquire on the SAME held instance throws 'Lock already acquired'", async () => {
    const lock = new LockFile(workspaceRoot, fs, createSpyLogger());
    try {
      await lock.acquire();
      await assert.rejects(
        () => lock.acquire(),
        /Lock already acquired/,
        "same-instance re-entry must fail with the in-process guard message",
      );
    } finally {
      await lock.forceRelease();
    }
  });

  it("a SECOND instance fails to acquire while the first still holds the lock", async () => {
    const loggerA = createSpyLogger();
    const loggerB = createSpyLogger();
    const first = new LockFile(workspaceRoot, fs, loggerA);
    const second = new LockFile(workspaceRoot, fs, loggerB);

    try {
      await first.acquire();

      await assert.rejects(
        () => second.acquire(),
        /Sync already in progress/,
        "cross-instance contention must surface the EEXIST-wrapped message",
      );

      // The second instance must NOT have flipped its internal `locked` flag.
      // We prove this by showing a subsequent `release()` on it does NOT
      // delete the file held by `first`, but merely logs the unheld-warning.
      await second.release();
      const lockPath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
      assert.equal(
        await exists(lockPath),
        true,
        "second.release() on a never-acquired lock must not tamper with the held lock",
      );
      assert.ok(
        loggerB.calls.some(
          (c) => c.level === "warn" && c.message.includes("unheld lock"),
        ),
        "second.release() must warn about attempting to release an unheld lock",
      );
    } finally {
      await first.forceRelease();
    }
  });

  it("after the holder releases, a waiting instance can acquire successfully", async () => {
    const first = new LockFile(workspaceRoot, fs, createSpyLogger());
    const second = new LockFile(workspaceRoot, fs, createSpyLogger());

    await first.acquire();
    await assert.rejects(() => second.acquire(), /Sync already in progress/);
    await first.release();

    // Now the second instance should succeed.
    await second.acquire();
    try {
      const lockPath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);
      assert.equal(
        await exists(lockPath),
        true,
        "handoff: second instance must own the file after first releases",
      );
    } finally {
      await second.release();
    }
  });
});

// ---------------------------------------------------------------------------
// Release idempotency / tolerance
// ---------------------------------------------------------------------------

describe("LockFile — release semantics", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await makeTmpWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("release() on a never-acquired lock does not throw, only warns", async () => {
    const logger = createSpyLogger();
    const lock = new LockFile(workspaceRoot, fs, logger);

    await lock.release(); // must not throw

    assert.ok(
      logger.calls.some(
        (c) => c.level === "warn" && c.message.includes("unheld lock"),
      ),
      "release on an unheld lock must emit a warn",
    );
  });

  it("release() is effectively idempotent (second release after proper release warns, no throw)", async () => {
    const logger = createSpyLogger();
    const lock = new LockFile(workspaceRoot, fs, logger);

    await lock.acquire();
    await lock.release();

    // Second release must not throw — it takes the unheld-lock branch.
    await lock.release();

    const warnCalls = logger.calls.filter(
      (c) => c.level === "warn" && c.message.includes("unheld lock"),
    );
    assert.equal(
      warnCalls.length,
      1,
      "exactly one unheld-lock warn from the redundant release",
    );
  });

  it("release() tolerates external removal of the lock file (ENOENT branch)", async () => {
    const logger = createSpyLogger();
    const lock = new LockFile(workspaceRoot, fs, logger);
    const lockPath = path.join(workspaceRoot, LOCK_RELATIVE_PATH);

    await lock.acquire();
    // Simulate an operator manually deleting the lock out from under us.
    await fs.unlink(lockPath);

    // Must not throw; must reset internal state so a fresh acquire works.
    await lock.release();
    assert.ok(
      logger.calls.some(
        (c) => c.level === "warn" && c.message.includes("already removed"),
      ),
      "ENOENT on unlink must log the 'already removed' warning",
    );

    // State should be clean enough to acquire again.
    await lock.acquire();
    try {
      assert.equal(await exists(lockPath), true);
    } finally {
      await lock.release();
    }
  });

  it("forceRelease() never throws, even on a never-acquired lock", async () => {
    const lock = new LockFile(workspaceRoot, fs, createSpyLogger());
    // No acquire. Must simply swallow the ENOENT on unlink.
    await lock.forceRelease();
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("LockFile — error paths", () => {
  it("acquire() rethrows raw errno when .architecture/ directory is missing", async () => {
    // Use a fresh tmp dir WITHOUT the .architecture/ subdir created.
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-lock-test-noarch-"),
    );
    try {
      const lock = new LockFile(workspaceRoot, fs, createSpyLogger());

      // Current behaviour: the error is NOT EEXIST, so the catch block
      // re-throws it raw. Documents the current (un-wrapped) contract.
      await assert.rejects(
        () => lock.acquire(),
        (err: unknown) => {
          assert.ok(err instanceof Error, "error must be an Error instance");
          // We accept either an ENOENT errno (expected on darwin/linux) or
          // anything else, as long as it's NOT the EEXIST "already in progress"
          // wrapped message — that would indicate a false positive.
          assert.doesNotMatch(
            (err as Error).message,
            /Sync already in progress/,
            "missing-directory failure must NOT be mis-reported as contention",
          );
          return true;
        },
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("acquire() fails cleanly when a non-EEXIST fs error is injected", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-lock-test-inject-"),
    );
    try {
      await fs.mkdir(path.join(workspaceRoot, ".architecture"), {
        recursive: true,
      });

      // Inject a fake fs whose `open` throws EACCES.
      const injectedFs = {
        ...fs,
        open: async (): Promise<never> => {
          const err = new Error("permission denied") as NodeJS.ErrnoException;
          err.code = "EACCES";
          throw err;
        },
      } as unknown as typeof fs;

      const lock = new LockFile(workspaceRoot, injectedFs, createSpyLogger());

      await assert.rejects(
        () => lock.acquire(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match((err as Error).message, /permission denied/);
          // Document the behaviour: LockFile currently rethrows the raw
          // errno error. A future hardening could wrap this in a typed
          // SyncError — see module-level notes.
          assert.doesNotMatch(
            (err as Error).message,
            /Sync already in progress/,
            "non-EEXIST errors must NOT be reported as contention",
          );
          return true;
        },
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrency safety
// ---------------------------------------------------------------------------

describe("LockFile — concurrency safety", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await makeTmpWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("two concurrent acquire() calls on TWO instances yield exactly one winner", async () => {
    const a = new LockFile(workspaceRoot, fs, createSpyLogger());
    const b = new LockFile(workspaceRoot, fs, createSpyLogger());

    const results = await Promise.allSettled([a.acquire(), b.acquire()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    assert.equal(
      fulfilled.length,
      1,
      "exactly one concurrent acquire must succeed",
    );
    assert.equal(
      rejected.length,
      1,
      "exactly one concurrent acquire must fail with the contention error",
    );
    assert.match(
      String((rejected[0].reason as Error).message),
      /Sync already in progress/,
      "loser's error must be the EEXIST-wrapped contention message",
    );

    // Cleanup: whichever instance won must release.
    await a.forceRelease();
    await b.forceRelease();
  });

  it("concurrent acquire() calls on the SAME instance yield exactly one winner", async () => {
    // When both calls enter before the first `await`, both pass the
    // synchronous `if (this.locked)` guard. Both then race on fs.open(..., "wx").
    // The OS atomicity of O_EXCL|O_CREAT guarantees one winner at the
    // filesystem level — the loser throws EEXIST.
    const lock = new LockFile(workspaceRoot, fs, createSpyLogger());

    const results = await Promise.allSettled([lock.acquire(), lock.acquire()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    assert.equal(
      fulfilled.length,
      1,
      "same-instance concurrent acquire: exactly one must succeed",
    );
    assert.equal(
      rejected.length,
      1,
      "same-instance concurrent acquire: exactly one must fail",
    );
    assert.match(
      String((rejected[0].reason as Error).message),
      // Could be either the in-process guard OR the EEXIST contention —
      // depends on microtask interleaving. Both are acceptable "loser" shapes.
      /Lock already acquired|Sync already in progress/,
      "loser must surface a contention-related message",
    );

    await lock.forceRelease();
  });
});
