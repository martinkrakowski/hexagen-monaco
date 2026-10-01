import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

/**
 * The gate lock. Drives the real script the way the package's own bin tests
 * drive the real bins: a fresh TMPDIR per test, so no test ever touches the
 * real lock at the host's own tmp; a pid the test chose deliberately inside
 * that lock, since the lock's whole contract is judged from what it records
 * (owner, pid, started, beat).
 *
 * Exit 75 = busy is the contract this file defines; every reclaim path — dead
 * pid, stale beat — must say so on stdout before it takes the lock.
 *
 * `run <lane> -- <command>` holds the lock around a command as the command's
 * own holder. The tests below drive the real process and the real signals: the
 * pid the lock names is `run` itself, INT/TERM reach the command and not just
 * the wrapper, and the lock is gone when `run` is. The signal cases run under
 * /bin/sh AND under dash when the host has it, because dash is CI's /bin/sh and
 * it is the shell in which the trap-on-a-foreground-child deferral was
 * measured.
 */

const gateLock = fileURLToPath(new URL("../../bin/gate-lock", import.meta.url));

/**
 * The shells the signal tests drive. CI's /bin/sh IS dash; a macOS host's is
 * bash in POSIX mode. A behaviour that differs between them is the whole risk
 * in a script that forwards signals, so both are run wherever both exist.
 */
const SIGNAL_SHELLS: string[] = existsSync("/bin/dash")
  ? ["sh", "/bin/dash"]
  : ["sh"];

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "hexagen-gate-lock-"));
  dirs.push(dir);
  return dir;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  pid?: number;
}

function runLockIn(
  dir: string,
  args: string[],
  env: Record<string, string> = {},
  timeout = 15_000,
  shell = "sh",
  cwd?: string,
): RunResult {
  const result = spawnSync(shell, [gateLock, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, HEXAGEN_GATE_SLOTS: "1", TMPDIR: dir, ...env },
    timeout,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    pid: result.pid,
  };
}

/** The lock directory a test's TMPDIR maps to, and a writer for its five files. */
function lockDir(dir: string): string {
  return join(dir, "hexagen-gate.lock");
}

function seedLock(
  dir: string,
  holder: {
    owner?: string;
    pid?: number;
    started?: number;
    beat?: number;
    /** Which slot: 1 is the base lock, K the `.slotK` sibling. */
    slot?: number;
    /** The holder's worktree identity; no file is written when absent. */
    worktree?: string;
  },
): string {
  const lock = slotDir(dir, holder.slot ?? 1);
  mkdirSync(lock, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(join(lock, "owner"), `${holder.owner ?? "other-lane"}\n`);
  writeFileSync(join(lock, "started"), `${holder.started ?? now}\n`);
  writeFileSync(join(lock, "pid"), `${holder.pid ?? process.pid}\n`);
  writeFileSync(join(lock, "beat"), `${holder.beat ?? now}\n`);
  if (holder.worktree !== undefined)
    writeFileSync(join(lock, "worktree"), `${holder.worktree}\n`);
  return lock;
}

/** The directory of slot K under a test's TMPDIR. */
function slotDir(dir: string, slot: number): string {
  return slot === 1 ? lockDir(dir) : `${lockDir(dir)}.slot${slot}`;
}

/** A pid that is not alive: spawn a short child, reap it, use its pid. */
function reapedPid(): number {
  const child = spawnSync("true");
  if (child.pid === undefined) throw new Error("spawnSync produced no pid");
  return child.pid;
}

function lockFile(dir: string, name: string): string {
  return readFileSync(join(lockDir(dir), name), "utf8");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the lock script without waiting for it, and hand back the live child:
 * a test that signals a `run` needs its pid, and the lock's own `pid` file is
 * the claim under test, so the two are compared rather than one standing in
 * for the other.
 */
function startLockIn(
  dir: string,
  args: string[],
  env: Record<string, string> = {},
  shell = "sh",
  cwd?: string,
): { child: ChildProcess; done: Promise<RunResult> } {
  const child = spawn(shell, [gateLock, ...args], {
    cwd,
    env: { ...process.env, HEXAGEN_GATE_SLOTS: "1", TMPDIR: dir, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise<RunResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        status: code ?? -1,
        stdout,
        stderr,
        pid: child.pid ?? undefined,
      }),
    );
  });
  return { child, done };
}

/** Run the lock script without waiting for it — for tests that race it. */
function runLockAsyncIn(
  dir: string,
  args: string[],
  env: Record<string, string> = {},
  shell = "sh",
): Promise<RunResult> {
  return startLockIn(dir, args, env, shell).done;
}

/** Poll until the path exists — the handshake for the script's test pauses. */
async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Poll until the path exists AND holds something. A file appears when it is
 * opened, which is before anything is written into it, so a pause marker and a
 * pid a command published are not the same wait: waiting for the marker means
 * waiting for the file, and waiting for the pid means waiting for the value.
 * Reading the pid out of a file that exists but is not yet written gives 0.
 */
async function waitForContent(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(path) && readFileSync(path, "utf8").trim() !== "") return;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${path} to have content`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Poll until the lock exists at the name — which is also when it is complete. */
async function waitForLock(dir: string): Promise<void> {
  await waitForFile(lockDir(dir));
}

/**
 * Poll until a condition holds, and name what it was waiting for when it does
 * not. A bare `await done` cannot tell a run that reacted from one still
 * waiting out the command it never signalled: the promise simply does not
 * settle, and the failure a reader gets is the test's own timeout, naming the
 * timeout rather than the claim.
 *
 * It THROWS on the deadline rather than returning false, so the reason travels
 * with it; the callers that want a boolean to assert on catch it and compare
 * `false`, which is what puts the claim in the assertion instead of in a stack.
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/**
 * Poll until a pid is gone. A process told to die needs a moment, and a test
 * that asserted instantly would be reading scheduling luck; one that waited
 * out the whole process would be hiding the very failure it is looking for —
 * `sleep 30` outlives any timeout a test may set, so a command that was not
 * signalled reads as alive, not as slow.
 */
async function waitForDead(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline)
      throw new Error(`pid ${pid} is still alive after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The pid of the heartbeat `run` started, from the line it printed. */
function heartbeatPidOf(stdout: string): number {
  const match = /gate-lock: heartbeat pid (\d+)/.exec(stdout);
  if (!match) throw new Error(`no heartbeat pid line in:\n${stdout}`);
  return Number(match[1]);
}

function leftoverCands(dir: string): string[] {
  return readdirSync(dir).filter((entry) =>
    entry.startsWith("hexagen-gate.lock.cand."),
  );
}

describe("the gate lock", () => {
  test("parses as POSIX sh", () => {
    const result = spawnSync("sh", ["-n", gateLock], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("parses under dash too, when the host has it", () => {
    if (!existsSync("/bin/dash")) return;
    const result = spawnSync("/bin/dash", ["-n", gateLock], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("acquire records the caller's pid when HEXAGEN_GATE_CALLER_PID is given", () => {
    const dir = scratch();
    const result = runLockIn(dir, ["acquire", "lane-a"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("acquired by lane-a");
    expect(lockFile(dir, "owner").trim()).toBe("lane-a");
    expect(lockFile(dir, "pid").trim()).toBe("424242");
    expect(Number(lockFile(dir, "started"))).toBeGreaterThan(0);
    expect(Number(lockFile(dir, "beat"))).toBeGreaterThan(0);
  });

  test("a bare acquire is refused, naming run, and so is one made while the lock is held", () => {
    // A bare `acquire` can only record the pid of the `sh` that is running it,
    // and that process is gone the moment acquire returns — so the lock it
    // wrote is reclaimable before the caller has run a step, and the caller is
    // told it succeeded. There is no way to make that call safe, so it is
    // refused instead.
    const dir = scratch();
    const free = runLockIn(dir, ["acquire", "lane-a"]);
    expect(free.status).toBe(2);
    expect(free.stderr).toContain("HEXAGEN_GATE_CALLER_PID");
    expect(free.stderr).toContain("run");
    // Nothing was written: a refused acquire must not leave a lock nobody holds.
    expect(existsSync(lockDir(dir))).toBe(false);

    // Held as well: "busy" would be an answer to a call that cannot work, and
    // 75 would send a caller off to retry something that can never succeed.
    seedLock(dir, { pid: process.pid, owner: "lane-a" });
    const held = runLockIn(dir, ["acquire", "lane-b"]);
    expect(held.status).toBe(2);
    expect(held.stderr).toContain("run");
    // The holder's lock is untouched — refused, not busy, and certainly not
    // reclaimed.
    expect(lockFile(dir, "owner").trim()).toBe("lane-a");
    expect(lockFile(dir, "pid").trim()).toBe(String(process.pid));
  });

  test("a live holder makes acquire exit 75", () => {
    const dir = scratch();
    seedLock(dir, { pid: process.pid, owner: "lane-a" });
    const result = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
    });
    expect(result.status).toBe(75);
    expect(result.stderr).toContain("busy");
    expect(result.stderr).toContain("lane-a");
    // A busy acquire leaves the holder's lock exactly as it found it.
    expect(lockFile(dir, "owner").trim()).toBe("lane-a");
  });

  test("a lock whose pid is not alive is reclaimed, and acquire says so", () => {
    const dir = scratch();
    const dead = reapedPid();
    expect(isAlive(dead)).toBe(false);
    seedLock(dir, { pid: dead, owner: "lane-a" });
    const result = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reclaiming");
    expect(result.stdout).toContain("not alive");
    expect(lockFile(dir, "owner").trim()).toBe("lane-b");
    expect(lockFile(dir, "pid").trim()).toBe("424242");
  });

  test("a lock whose beat is older than 10 minutes is reclaimed, and acquire says so", () => {
    const dir = scratch();
    const stale = Math.floor(Date.now() / 1000) - 700;
    seedLock(dir, { pid: process.pid, owner: "lane-a", beat: stale });
    const result = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reclaiming");
    expect(result.stdout).toContain("stale");
    expect(lockFile(dir, "owner").trim()).toBe("lane-b");
  });

  test("HEXAGEN_GATE_STALE_SECONDS overrides the 10-minute threshold", () => {
    const dir = scratch();
    const old = Math.floor(Date.now() / 1000) - 700;
    seedLock(dir, { pid: process.pid, owner: "lane-a", beat: old });
    // Under a widened threshold the same beat is fresh, so the lock is busy…
    const widened = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
      HEXAGEN_GATE_STALE_SECONDS: "3600",
    });
    expect(widened.status).toBe(75);
    expect(lockFile(dir, "owner").trim()).toBe("lane-a");
    // …and a tightened threshold reclaims a beat the default would call fresh.
    const tightened = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
      HEXAGEN_GATE_STALE_SECONDS: "60",
    });
    expect(tightened.status).toBe(0);
    expect(tightened.stdout).toContain("reclaiming");
  });

  test("a reclaimer that renamed its replacement restores it, never deletes it", async () => {
    // The reclaim race: the reclaimer judges a stale lock, pauses (test hook),
    // and in that window the stale holder is replaced by a fresh acquirer.
    // The rename then moves the REPLACEMENT, which was never judged — it must
    // be restored (the name is free) and never deleted.
    const dir = scratch();
    const marker = join(dir, "paused-after-inspect");
    seedLock(dir, {
      owner: "lane-old",
      pid: reapedPid(),
      beat: Math.floor(Date.now() / 1000) - 700,
    });
    const pending = runLockAsyncIn(dir, ["acquire", "lane-new"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
      HEXAGEN_GATE_TEST_PAUSE_AFTER_INSPECT: marker,
    });
    await waitForFile(marker);
    const replacement = seedLock(dir, {
      owner: "lane-replacement",
      pid: process.pid,
    });
    rmSync(marker);
    const result = await pending;
    expect(result.status).toBe(75);
    expect(result.stderr).toContain("busy");
    expect(result.stderr).toContain("reclaim aborted");
    // The replacement is back at the name, byte for byte as its holder wrote it.
    expect(lockFile(dir, "owner").trim()).toBe("lane-replacement");
    expect(lockFile(dir, "pid").trim()).toBe(String(process.pid));
    expect(existsSync(replacement)).toBe(true);
    expect(
      readdirSync(dir).some((e) => e.startsWith("hexagen-gate.lock.reclaim.")),
    ).toBe(false);
  }, 15_000);

  test("a reclaimer whose replacement was moved while the name is taken leaves it aside, never deletes it", async () => {
    const dir = scratch();
    const markerInspect = join(dir, "paused-after-inspect");
    const markerRestore = join(dir, "paused-before-restore");
    seedLock(dir, {
      owner: "lane-old",
      pid: reapedPid(),
      beat: Math.floor(Date.now() / 1000) - 700,
    });
    const pending = runLockAsyncIn(dir, ["acquire", "lane-new"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
      HEXAGEN_GATE_TEST_PAUSE_AFTER_INSPECT: markerInspect,
      HEXAGEN_GATE_TEST_PAUSE_BEFORE_RESTORE: markerRestore,
    });
    await waitForFile(markerInspect);
    seedLock(dir, { owner: "lane-replacement", pid: process.pid });
    rmSync(markerInspect);
    // The reclaimer has now moved the replacement aside and is paused again,
    // before restoring it; the name is free. A third acquirer takes it.
    await waitForFile(markerRestore);
    seedLock(dir, { owner: "lane-late", pid: process.pid });
    rmSync(markerRestore);
    const result = await pending;
    expect(result.status).toBe(75);
    expect(result.stderr).toContain("never deleted");
    // The name holds the third acquirer's lock, intact…
    expect(lockFile(dir, "owner").trim()).toBe("lane-late");
    // …and the moved replacement is still aside, untouched by the reclaimer.
    expect(
      readdirSync(dir).filter((e) =>
        e.startsWith("hexagen-gate.lock.reclaim."),
      ),
    ).toHaveLength(1);
    const aside = readdirSync(dir).find((entry) =>
      entry.startsWith("hexagen-gate.lock.reclaim."),
    );
    if (!aside)
      throw new Error(
        "the moved replacement was deleted rather than left aside",
      );
    expect(readFileSync(join(dir, aside, "owner"), "utf8").trim()).toBe(
      "lane-replacement",
    );
  }, 15_000);

  test("a non-numeric stale threshold is refused", () => {
    const dir = scratch();
    // Order matters, and this call has two things wrong with it: a bad
    // HEXAGEN_GATE_STALE_SECONDS is a broken invocation whichever subcommand it
    // arrived on, so it is reported as itself — not as the bare-acquire
    // refusal that comes next — and the caller is told about the variable it
    // actually set wrong.
    const result = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_STALE_SECONDS: "soon",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("HEXAGEN_GATE_STALE_SECONDS");
    expect(result.stderr).not.toContain("refused — the only pid");
  });

  test("a lock with no pid or beat at all is reclaimed", () => {
    // An abandoned half-written lock: a directory with an owner and nothing
    // else. The read-waits bound the patience, then it is reclaimed.
    const dir = scratch();
    const lock = lockDir(dir);
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner"), "lane-a\n");
    const result = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reclaiming");
    expect(lockFile(dir, "owner").trim()).toBe("lane-b");
  });

  test("a creator paused before the rename leaves no lock at the name, then completes atomically", async () => {
    // Creation writes the candidate aside and renames it onto the name, so a
    // contender can never observe a half-written lock — only an abandoned one.
    const dir = scratch();
    const marker = join(dir, "paused-before-mv");
    const pending = runLockAsyncIn(dir, ["acquire", "lane-a"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
      HEXAGEN_GATE_TEST_PAUSE_BEFORE_MV: marker,
    });
    await waitForFile(marker);
    expect(existsSync(lockDir(dir))).toBe(false);
    const candDir = leftoverCands(dir).at(0);
    if (!candDir)
      throw new Error("no candidate directory while the creator is paused");
    expect(readFileSync(join(dir, candDir, "owner"), "utf8").trim()).toBe(
      "lane-a",
    );
    expect(readFileSync(join(dir, candDir, "pid"), "utf8").trim()).toBe(
      "424242",
    );
    expect(
      Number(readFileSync(join(dir, candDir, "beat"), "utf8")),
    ).toBeGreaterThan(0);
    rmSync(marker);
    const result = await pending;
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("acquired by lane-a");
    expect(lockFile(dir, "owner").trim()).toBe("lane-a");
    expect(lockFile(dir, "pid").trim()).toBe("424242");
    expect(leftoverCands(dir)).toEqual([]);
  }, 15_000);

  test("a creator paused before the rename loses the name to a contender and reports busy", async () => {
    const dir = scratch();
    const marker = join(dir, "paused-before-mv");
    const pending = runLockAsyncIn(dir, ["acquire", "lane-a"], {
      HEXAGEN_GATE_CALLER_PID: "424242",
      HEXAGEN_GATE_TEST_PAUSE_BEFORE_MV: marker,
    });
    await waitForFile(marker);
    // The contender takes the name while the first is paused before its rename.
    const contender = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: String(process.pid),
    });
    expect(contender.status).toBe(0);
    rmSync(marker);
    const result = await pending;
    expect(result.status).toBe(75);
    expect(result.stderr).toContain("busy");
    expect(result.stderr).toContain("lane-b");
    // The winner's lock is intact, and no candidate directories leak.
    expect(lockFile(dir, "owner").trim()).toBe("lane-b");
    expect(leftoverCands(dir)).toEqual([]);
  }, 15_000);

  test("heartbeat refreshes the beat, and fails loudly without a lock", () => {
    const dir = scratch();
    seedLock(dir, { pid: process.pid, beat: 1000 });
    const result = runLockIn(dir, ["heartbeat"], {
      HEXAGEN_GATE_CALLER_PID: String(process.pid),
    });
    expect(result.status).toBe(0);
    expect(Number(lockFile(dir, "beat"))).toBeGreaterThan(1000);

    const empty = scratch();
    const orphan = runLockIn(empty, ["heartbeat"]);
    expect(orphan.status).not.toBe(0);
    expect(orphan.stderr).toContain("no lock");
  });

  test("a heartbeat from a pid that does not hold the lock is refused and touches nothing", () => {
    const dir = scratch();
    seedLock(dir, { pid: 424242, beat: 1000 });
    const result = runLockIn(dir, ["heartbeat"], {
      HEXAGEN_GATE_CALLER_PID: "999999",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("heartbeat refused");
    expect(lockFile(dir, "beat").trim()).toBe("1000");
  });

  test("status reports free, and reports the holder with its liveness", () => {
    const empty = scratch();
    const free = runLockIn(empty, ["status"]);
    expect(free.status).toBe(0);
    expect(free.stdout).toContain("free");

    const dir = scratch();
    seedLock(dir, { pid: process.pid, owner: "lane-a" });
    const held = runLockIn(dir, ["status"]);
    expect(held.status).toBe(0);
    expect(held.stdout).toContain("lane-a");
    expect(held.stdout).toContain("alive");

    const dead = reapedPid();
    seedLock(dir, { pid: dead, owner: "lane-a" });
    const lifeless = runLockIn(dir, ["status"]);
    expect(lifeless.stdout).toContain("not alive");
  });

  test("release removes the holder's own lock and is idempotent when it is already gone", () => {
    const dir = scratch();
    seedLock(dir, { pid: process.pid, owner: "lane-a" });
    const result = runLockIn(dir, ["release", "lane-a"], {
      HEXAGEN_GATE_CALLER_PID: String(process.pid),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("released");
    expect(existsSync(lockDir(dir))).toBe(false);

    const again = runLockIn(dir, ["release", "lane-a"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("nothing to release");
  });

  test("a release from a holder whose lock was reclaimed is refused and leaves the new lock intact", () => {
    // The original holder's pid is a reaped one: another holder reclaimed its
    // stale lock (dead pid) and now owns it. The old holder's cleanup must
    // not delete the replacement.
    const dir = scratch();
    const dead = reapedPid();
    seedLock(dir, { pid: dead, owner: "lane-a" });
    const reclaim = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: "434343",
    });
    expect(reclaim.status).toBe(0);
    expect(lockFile(dir, "owner").trim()).toBe("lane-b");

    // The old holder's release: right owner name is not enough on its own…
    const wrongPid = runLockIn(dir, ["release", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: String(dead),
    });
    expect(wrongPid.status).not.toBe(0);
    expect(wrongPid.stderr).toContain("release refused");
    expect(lockFile(dir, "owner").trim()).toBe("lane-b");

    // …and the wrong lane name is refused even with a matching pid.
    const wrongOwner = runLockIn(dir, ["release", "lane-a"], {
      HEXAGEN_GATE_CALLER_PID: "434343",
    });
    expect(wrongOwner.status).not.toBe(0);
    expect(wrongOwner.stderr).toContain("release refused");
    expect(lockFile(dir, "owner").trim()).toBe("lane-b");

    // The rightful holder still releases it.
    const right = runLockIn(dir, ["release", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: "434343",
    });
    expect(right.status).toBe(0);
    expect(existsSync(lockDir(dir))).toBe(false);
  });

  test("a release that cannot remove the lock reports failure and leaves it in place", () => {
    // A read-only lock directory defeats rm: the removal must fail loudly,
    // not be announced as released while the lock lingers.
    const dir = scratch();
    const lock = seedLock(dir, { pid: process.pid, owner: "lane-a" });
    chmodSync(lock, 0o555);
    const result = runLockIn(dir, ["release", "lane-a"], {
      HEXAGEN_GATE_CALLER_PID: String(process.pid),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("release failed");
    expect(existsSync(lock)).toBe(true);
    // Let the cleanup remove the scratch dir again.
    chmodSync(lock, 0o755);
  });

  test("an unknown subcommand exits 2 with the usage", () => {
    const dir = scratch();
    const result = runLockIn(dir, ["grab", "lane-a"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage");
  });
});

// The command the lock exists for. Everything here is about one claim: the pid
// in the lock is a process that is alive for as long as the command runs, so
// the lock cannot be taken from under it and the command cannot outlive the
// signal that was meant to stop it.
describe("the gate lock: run <lane> -- <command>", () => {
  test("holds the lock under its own pid while the command runs, and is busy to everyone else", async () => {
    const dir = scratch();
    // The command waits for the test to let it finish, so the lock is
    // provably held for the whole window in which the contender looks at it —
    // not merely held at some point during a run that may already be over.
    const { child, done } = startLockIn(
      dir,
      [
        "run",
        "lane-a",
        "--",
        "sh",
        "-c",
        'while [ ! -f "$TMPDIR/go" ]; do sleep 1; done',
      ],
      // An inherited caller pid is exactly what `run` must ignore: it belongs
      // to whatever launched this script, and that is free to exit mid-command.
      { HEXAGEN_GATE_CALLER_PID: "424242" },
    );
    await waitForLock(dir);
    expect(lockFile(dir, "owner").trim()).toBe("lane-a");
    expect(lockFile(dir, "pid").trim()).toBe(String(child.pid));

    const contender = runLockIn(dir, ["acquire", "lane-b"], {
      HEXAGEN_GATE_CALLER_PID: String(process.pid),
    });
    expect(contender.status).toBe(75);
    expect(contender.stderr).toContain("busy");
    // The refusal leaves the holder's lock — and its pid — exactly as it was.
    expect(lockFile(dir, "pid").trim()).toBe(String(child.pid));
    expect(lockFile(dir, "owner").trim()).toBe("lane-a");

    writeFileSync(join(dir, "go"), "");
    const result = await done;
    expect(result.status).toBe(0);
    // Released the moment the command is done: a lock outliving its run is a
    // lock the next lane trips over for no reason.
    expect(existsSync(lockDir(dir))).toBe(false);
  }, 15_000);

  test("its heartbeat keeps the beat fresh for as long as the command runs", () => {
    const dir = scratch();
    // A 1s tick has to land while the command is still running, and the
    // command polls for it in a bounded loop rather than reading once after a
    // fixed sleep: `date +%s` is second granularity, so a single read is a
    // coin flip on a loaded host, and a coin flip in a test is a flake. The
    // bound is the assertion — the command exits non-zero if the beat never
    // moves — and the 20s timeout is calibrated to the bound, not raised to
    // hide one.
    const result = runLockIn(
      dir,
      [
        "run",
        "lane-a",
        "--",
        "sh",
        "-c",
        'i=0; while [ "$i" -lt 10 ]; do if [ "$(cat "$TMPDIR/hexagen-gate.lock/beat" 2>/dev/null)" -gt "$(cat "$TMPDIR/hexagen-gate.lock/started" 2>/dev/null)" ] 2>/dev/null; then exit 0; fi; i=$((i + 1)); sleep 1; done; exit 1',
      ],
      { HEXAGEN_GATE_HEARTBEAT_SECONDS: "1" },
    );
    // stderr is part of the assertion, not decoration: a run whose beat moved
    // has nothing to report, so anything on stderr here is the reason the beat
    // did not — the lock-lost message, a failed release — and it belongs in
    // the failure a reader has to diagnose.
    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
    expect(result.stdout).toContain("heartbeat pid");
  }, 20_000);

  test("a reader never catches the beat empty while the heartbeat refreshes it", async () => {
    // Under both shells, like the signal tests: the beat is written by a
    // subshell that sleeps and forks, and the two shells differ in what they
    // defer and when, so a property of the beat that holds under one of them is
    // a property of that shell until it has been run under the other.
    for (const shell of SIGNAL_SHELLS) {
      const dir = scratch();
      // `acquire` and `status` read the beat, and an empty one reads as STALE:
      // a reader that caught a heartbeat mid-write would judge a live,
      // heartbeating holder's lock reclaimable, and take it. The beat is
      // replaced by a rename, so a reader sees the previous beat or the next one
      // and never nothing. Hammering the file for the life of a run that
      // heartbeats every second is the only way to look at that window; the
      // sample count is asserted too, so a reader that stalled cannot pass this
      // by having read nothing.
      const { child, done } = startLockIn(
        dir,
        ["run", "lane-a", "--", "sleep", "7"],
        {
          HEXAGEN_GATE_HEARTBEAT_SECONDS: "1",
        },
        shell,
      );
      await waitForLock(dir);
      const beat = join(lockDir(dir), "beat");
      let reads = 0;
      let empty = 0;
      let missing = 0;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        let value: string;
        try {
          value = readFileSync(beat, "utf8");
        } catch {
          // Counted, not skipped: the beat is replaced by a rename, so it is
          // never absent, and a read that fails is a defect this test would
          // otherwise step over — on the way to passing on the reads that worked.
          missing += 1;
          continue;
        }
        reads += 1;
        if (value === "") empty += 1;
        // Yield periodically, so the child's stdout and stderr keep being drained
        // while this loop runs. Nothing here fills a pipe today — `run` prints two
        // lines and the heartbeat's stdio is detached — but a reader that starves
        // the writer it is measuring is a measurement that can stop measuring.
        if (reads % 500 === 0)
          await new Promise((resolve) => setImmediate(resolve));
      }
      // All three, and the sample count with them: a reader that stalled, or one
      // whose reads were all failures, must not be able to pass.
      expect({ shell, reads: reads > 1000, empty, missing }).toEqual({
        shell,
        reads: true,
        empty: 0,
        missing: 0,
      });
      process.kill(child.pid as number, "SIGTERM");
      const result = await done;
      expect({ shell, status: result.status }).toEqual({ shell, status: 143 });
    }
  }, 30_000);

  /**
   * One signal, from outside, at a `run` that is holding the lock around a
   * command which is not going to stop on its own. Everything asserted here is
   * about the command, not the wrapper: the wrapper's exit code says it reacted,
   * and only the command's own pid says it stopped.
   *
   * `times` is how many signals are sent, 500ms apart — a second one landing
   * while the first is still being handled is what a CI timeout does, and the
   * two shells answered it differently enough to cost a lock (see the notes on
   * forward_signal). A `times: 2` signal may find `run` already gone, which is
   * the exec-mode case below: `exec sleep 30` dies on the forwarded TERM at
   * once, so there is no window for a second signal to fall into, and a signal
   * to a dead pid is a fact about the test's timing, not a failure to report.
   */
  async function signalRun(
    shell: string,
    signal: "SIGINT" | "SIGTERM",
    expectedStatus: number,
    times = 1,
  ): Promise<void> {
    const dir = scratch();
    // The command reports the pid it will be — it execs, so the pid it
    // publishes IS the sleep's — because "run exited" is not the claim under
    // test: "the command died with it" is, and only its own pid can show it.
    const commandPidFile = join(dir, "command.pid");
    const { child, done } = startLockIn(
      dir,
      [
        "run",
        "lane-a",
        "--",
        "sh",
        "-c",
        // The sleep's own stdio is dropped so that a signal this wrapper
        // FORWARDED closes the pipe with it. A sleep that survives holds
        // `run`'s stdout open, and the test's result would then arrive when
        // the sleep did — half a minute later, as a timeout naming the wrong
        // thing, instead of as the command that outlived its wrapper.
        `printf '%s\\n' "$$" > "${commandPidFile}"; exec sleep 30 >/dev/null 2>&1`,
      ],
      { HEXAGEN_GATE_HEARTBEAT_SECONDS: "1" },
      shell,
    );
    await waitForContent(commandPidFile);
    const commandPid = Number(readFileSync(commandPidFile, "utf8").trim());
    expect(commandPid).toBeGreaterThan(0);
    expect(isAlive(commandPid)).toBe(true);
    // Signal the holder the way a person or a CI timeout would: the process
    // the lock names, which the tests above pin to `run` itself.
    expect(lockFile(dir, "pid").trim()).toBe(String(child.pid));
    const signalledAt = Date.now();
    for (let i = 0; i < times; i++) {
      try {
        if (child.exitCode === null) {
          process.kill(Number(lockFile(dir, "pid").trim()), signal);
        }
      } catch {
        // Already gone, which is the exec-mode outcome described above.
      }
      if (i + 1 < times)
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Bounded, because `await done` on its own cannot tell a run that reacted
    // from one that is still waiting out the command it never signalled: a
    // dropped forwarding shows up as this promise not settling for the full
    // 30s, and the test's own timeout fires and names the timeout instead of
    // the wrapper. Removing the `wait "$cmd_pid"` from forward_signal must fail
    // here, on a claim about elapsed time, and not on the clock running out.
    const settled = await waitFor(
      () => child.exitCode !== null || child.signalCode !== null,
      5_000,
      `run did not exit within 5000ms of ${signal}`,
    ).catch(() => false);
    expect({ shell, times, settled }).toEqual({ shell, times, settled: true });
    const elapsed = Date.now() - signalledAt;
    expect({ shell, withinBudget: elapsed < 5_000 }).toEqual({
      shell,
      withinBudget: true,
    });

    const result = await done;
    // 130/143 are INT/TERM's own conventions, so a caller can tell a signalled
    // run from a command that failed — and the EXIT trap still ran.
    expect({ shell, status: result.status }).toEqual({
      shell,
      status: expectedStatus,
    });
    expect(result.stdout).toContain("released by lane-a");
    expect(existsSync(lockDir(dir))).toBe(false);
    // The heartbeat is reaped, not merely orphaned: nothing may outlive the
    // run, or a later lock refreshes on a pid the test can no longer account for.
    await waitForDead(heartbeatPidOf(result.stdout));
    // The command died with the wrapper. A trap on a foreground child is
    // deferred until that child exits — measured at the full 30s under dash —
    // so the signal has to be forwarded, or this sleep outlives the run. And
    // for INT it has to be forwarded as TERM: a command started as an
    // asynchronous list inherits SIG_IGN for INT and QUIT (POSIX 2.11), so an
    // INT sent to a `sh` command is a no-op and the command outlives the run
    // by the whole 30 seconds — after the lock is already gone.
    await waitForDead(commandPid);
  }

  test("TERM on run exits 143, releases the lock, and takes the command and the heartbeat with it", async () => {
    for (const shell of SIGNAL_SHELLS) {
      await signalRun(shell, "SIGTERM", 143);
    }
  }, 30_000);

  test("INT on run exits 130, releases the lock, and stops the command too", async () => {
    for (const shell of SIGNAL_SHELLS) {
      await signalRun(shell, "SIGINT", 130);
    }
  }, 30_000);

  test("TERM twice on run still releases the lock and reaps the heartbeat", async () => {
    for (const shell of SIGNAL_SHELLS) {
      await signalRun(shell, "SIGTERM", 143, 2);
    }
  }, 30_000);

  test("INT twice on run still releases the lock and reaps the heartbeat", async () => {
    for (const shell of SIGNAL_SHELLS) {
      await signalRun(shell, "SIGINT", 130, 2);
    }
  }, 30_000);

  /**
   * The same two signals again against a command that is still ALIVE when the
   * second one lands, which is where the two shells parted company: bash
   * deferred the second TERM and re-entered forward_signal at exit, after the
   * command had been reaped, so the EXIT trap never ran and the lock stayed on
   * disk with the heartbeat still looping under a dead pid. Measured 6 runs in
   * 6 under /bin/sh before forward_signal ignored both signals; dash never had
   * the fault, which is why this runs under both.
   */
  async function teardownRun(
    shell: string,
    signal: "SIGINT" | "SIGTERM",
    expectedStatus: number,
    times: number,
  ): Promise<void> {
    const dir = scratch();
    // A command that is NOT dead the moment it is signalled: it catches TERM
    // and takes two seconds to tear down, marking the fact. A `run` that
    // killed and exited in the same breath would have handed the lock to the
    // next lane while this was still running — and the commands `run` wraps
    // (a test run, a mutate replay, a manifest verification) all write to the
    // tree.
    const stopped = join(dir, "stopped");
    const { child, done } = startLockIn(
      dir,
      [
        "run",
        "lane-a",
        "--",
        "sh",
        "-c",
        // `exec >/dev/null 2>&1` first: the command must not hold this test's
        // pipe open, or the result below would arrive when the COMMAND
        // finished rather than when `run` did, and the ordering under test
        // would be observed from the wrong end. `wait` (not a foreground
        // sleep) so the trap runs the moment the signal arrives, and the
        // orphan it leaves behind — the sleep, which has outlived its own
        // shell — is the reason the redirect is here as well.
        `exec >/dev/null 2>&1; trap 'sleep 2; echo stopped > "${stopped}"; exit 0' TERM; printf '%s\\n' "$$" > "${join(dir, "command.pid")}"; sleep 30 >/dev/null 2>&1 & wait`,
      ],
      { HEXAGEN_GATE_HEARTBEAT_SECONDS: "1" },
      shell,
    );
    await waitForContent(join(dir, "command.pid"));
    const commandPid = Number(
      readFileSync(join(dir, "command.pid"), "utf8").trim(),
    );
    expect(lockFile(dir, "pid").trim()).toBe(String(child.pid));
    for (let i = 0; i < times; i++) {
      try {
        if (child.exitCode === null) process.kill(child.pid as number, signal);
      } catch {
        // Already gone: nothing left to signal.
      }
      if (i + 1 < times)
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const result = await done;
    expect({ shell, times, status: result.status }).toEqual({
      shell,
      times,
      status: expectedStatus,
    });
    // The ordering, which is the whole claim: the command had finished
    // tearing down by the time the lock went away.
    expect({ shell, stoppedBeforeTheLockWent: existsSync(stopped) }).toEqual({
      shell,
      stoppedBeforeTheLockWent: true,
    });
    expect(existsSync(lockDir(dir))).toBe(false);
    expect(isAlive(commandPid)).toBe(false);
  }

  test("a signalled run holds the lock until the command has actually stopped", async () => {
    // INT and TERM share this path — both traps forward TERM — so both are
    // named: a run that only ever saw TERM here was never tested for the half
    // of its signal handling that a Ctrl-C takes.
    for (const shell of SIGNAL_SHELLS) {
      await teardownRun(shell, "SIGTERM", 143, 1);
      await teardownRun(shell, "SIGINT", 130, 1);
    }
  }, 60_000);

  /**
   * The extended half of the claim above, stated where the window is widest: the
   * command above takes TWO SECONDS to tear down after its TERM, and a `run`
   * that killed and exited in the same breath would have handed the lock to
   * this contender while the command was still writing to the tree. So the lock
   * is asked about, by name, in exactly that window — after the command's TERM
   * trap has been entered and before the marker exists — and it must answer 75. After the
   * marker exists, the lock directory is gone.
   *
   * Removing `wait "$cmd_pid"` from forward_signal makes this red: the lock is
   * released while the command is still tearing down, so the contender below
   * succeeds instead of reporting busy.
   */
  test("a signalled run holds the lock until the command has actually stopped, and the lock is gone once it has", async () => {
    for (const shell of SIGNAL_SHELLS) {
      const dir = scratch();
      const stopped = join(dir, "stopped");
      const commandPidFile = join(dir, "command.pid");
      const trapEntered = join(dir, "trap-entered");
      const { child, done } = startLockIn(
        dir,
        [
          "run",
          "lane-a",
          "--",
          "sh",
          "-c",
          `exec >/dev/null 2>&1; trap 'echo entered > "${trapEntered}"; sleep 2; echo stopped > "${stopped}"; exit 0' TERM; printf '%s\\n' "$$" > "${commandPidFile}"; sleep 30 >/dev/null 2>&1 & wait`,
        ],
        { HEXAGEN_GATE_HEARTBEAT_SECONDS: "1" },
        shell,
      );
      await waitForContent(commandPidFile);
      expect(lockFile(dir, "pid").trim()).toBe(String(child.pid));
      process.kill(child.pid as number, "SIGTERM");

      // Wait for the command's TERM trap to have been ENTERED. Sampling before
      // that would measure the signal's delivery latency, not the lock: the
      // contender could land before the command had been told to stop at all.
      // While the done-marker is absent the lock is still this run's, and a
      // contender is busy — busy is the only answer a caller can act on.
      await waitForContent(trapEntered);
      const during = runLockIn(dir, ["acquire", "lane-b"], {
        HEXAGEN_GATE_CALLER_PID: String(process.pid),
      });
      expect(during.status).toBe(75);
      expect(during.stderr).toContain("busy");
      // The command was mid-teardown when the contender asked, and nothing was
      // taken while it was.
      expect(existsSync(trapEntered)).toBe(true);
      expect(existsSync(stopped)).toBe(false);
      expect(lockFile(dir, "owner").trim()).toBe("lane-a");

      const result = await done;
      expect({ shell, status: result.status }).toEqual({ shell, status: 143 });
      expect(existsSync(stopped)).toBe(true);
      expect(existsSync(lockDir(dir))).toBe(false);
      await waitForDead(heartbeatPidOf(result.stdout));
    }
  }, 60_000);

  test("a second signal during the teardown still releases the lock and reaps the heartbeat", async () => {
    for (const shell of SIGNAL_SHELLS) {
      await teardownRun(shell, "SIGTERM", 143, 2);
      await teardownRun(shell, "SIGINT", 130, 2);
    }
  }, 60_000);

  test("exits with the command's own status, and still releases the lock", () => {
    const dir = scratch();
    // A builtin: under `&` it runs in the job's subshell, so `exit 3` is the
    // command's status and not this script's.
    const result = runLockIn(dir, ["run", "lane-a", "--", "exit", "3"]);
    expect(result.status).toBe(3);
    expect(existsSync(lockDir(dir))).toBe(false);
  });

  test("a command that replaces the lock fails the run, and the replacement survives", () => {
    const dir = scratch();
    // The reclaim seen from the other end: the lock is taken by someone else
    // while the command runs. `run` must not delete what replaced it, and must
    // not report the command's success over a lock it can no longer prove it
    // held.
    const replace = [
      'rm -rf "$TMPDIR/hexagen-gate.lock"',
      'mkdir "$TMPDIR/hexagen-gate.lock"',
      'printf "lane-c\\n" > "$TMPDIR/hexagen-gate.lock/owner"',
      `printf "${process.pid}\\n" > "$TMPDIR/hexagen-gate.lock/pid"`,
      'printf "$(date +%s)\\n" > "$TMPDIR/hexagen-gate.lock/started"',
      'printf "$(date +%s)\\n" > "$TMPDIR/hexagen-gate.lock/beat"',
    ].join("; ");
    const result = runLockIn(dir, ["run", "lane-a", "--", "sh", "-c", replace]);
    expect(result.status).not.toBe(0);
    // Verify first: with the lock simply deleted, release reports "nothing to
    // release" and succeeds, and a run that checked nothing else would exit 0
    // over a command that ran unprotected.
    expect(result.stderr).toContain("verify failed");
    expect(result.stderr).toContain("FAILED to release the lock");
    expect(result.stderr).toContain("release refused");
    expect(lockFile(dir, "owner").trim()).toBe("lane-c");
  });

  test("a command that takes the lock away is stopped, not left running without one", async () => {
    // Both shells: the loop that does the stopping is the one whose deferral
    // and re-entry behaviour differ, so the claim is only made once each shell
    // has been asked to keep it.
    for (const shell of SIGNAL_SHELLS) {
      const dir = scratch();
      // The heartbeat refreshes only a lock that still names this run, so a lock
      // that names someone else makes the refresh fail — and a failed refresh is
      // how the loop learns the lock is gone, since the foreground is blocked in
      // `wait` and cannot see it. The command must be stopped there and then: it
      // is running against a lock this run no longer holds, and letting it
      // finish is the failure the heartbeat exists to prevent.
      const completed = join(dir, "completed");
      const commandPidFile = join(dir, "command.pid");
      const replace = [
        'rm -rf "$TMPDIR/hexagen-gate.lock"',
        'mkdir "$TMPDIR/hexagen-gate.lock"',
        'printf "lane-c\\n" > "$TMPDIR/hexagen-gate.lock/owner"',
        `printf "${process.pid}\\n" > "$TMPDIR/hexagen-gate.lock/pid"`,
        'printf "$(date +%s)\\n" > "$TMPDIR/hexagen-gate.lock/started"',
        'printf "$(date +%s)\\n" > "$TMPDIR/hexagen-gate.lock/beat"',
        `printf '%s\\n' "$$" > "${commandPidFile}"`,
        // `wait`, not a foreground sleep, so the shell answers a TERM at once
        // instead of deferring it for the length of the sleep; the sleep's own
        // stdio is dropped so the orphan it leaves cannot hold this test's pipe.
        "sleep 8 >/dev/null 2>&1 & wait",
        `touch "${completed}"`,
      ].join("; ");
      const result = await runLockAsyncIn(
        dir,
        ["run", "lane-a", "--", "sh", "-c", replace],
        { HEXAGEN_GATE_HEARTBEAT_SECONDS: "1" },
        shell,
      );
      expect(result.status).not.toBe(0);
      // It says so, and says why the command ended: a 143 on its own is
      // indistinguishable from a caller that signalled the run.
      expect(result.stderr).toContain(
        "the lock was lost while the command ran",
      );
      const commandPid = Number(readFileSync(commandPidFile, "utf8").trim());
      // Stopped, not merely reported on: a command that reaches its own end
      // leaves the marker it wrote on the way out.
      expect({ shell, stopped: isAlive(commandPid) }).toEqual({
        shell,
        stopped: false,
      });
      expect({ shell, completed: existsSync(completed) }).toEqual({
        shell,
        completed: false,
      });
      // The replacement is still the replacement's: this run never deletes a
      // lock it does not hold, however it ends.
      expect(lockFile(dir, "owner").trim()).toBe("lane-c");
      expect(existsSync(lockDir(dir))).toBe(true);
    }
  }, 40_000);

  test("a release waits for a heartbeat refresh that is in flight, not past it", async () => {
    for (const shell of SIGNAL_SHELLS) {
      const dir = scratch();
      // The race this closes is between the loop's `rm -rf` of the lock and an
      // in-flight `sh gate-lock heartbeat` grandchild whose `mv` lands on
      // $LOCK/beat in the middle of it. Unforced, it is a 13-in-200 kind of
      // thing under /bin/sh and 18-in-200 under dash — every one a false
      // "release failed — could not remove … Directory not empty", a lock left
      // at the name, and a non-zero exit for a command that succeeded. A test
      // that only ran short runs would therefore be a test that fails one time
      // in fifteen and passes the rest, which is not a test.
      //
      // So the window is pinned open instead. The hook holds ONE refresh
      // between staging its beat and renaming it onto the lock — inside the
      // grandchild, which is the only place the race lives: the old code killed
      // this loop, went straight on to `rm -rf` the lock, and that grandchild
      // then renamed a file into the directory being emptied.
      const marker = join(dir, "paused-before-beat-mv");
      const { child, done } = startLockIn(
        dir,
        ["run", "lane-a", "--", "sleep", "30"],
        {
          HEXAGEN_GATE_HEARTBEAT_SECONDS: "1",
          HEXAGEN_GATE_TEST_PAUSE_BEFORE_BEAT_MV: marker,
        },
        shell,
      );
      await waitForLock(dir);
      await waitForFile(marker);
      // A refresh is now sitting in the hook with its beat staged. Signalled
      // while it is there, the cleanup has to wait for it: that is the claim.
      expect(lockFile(dir, "pid").trim()).toBe(String(child.pid));
      process.kill(child.pid as number, "SIGTERM");

      // Give the run long enough to have released the lock if it were going to.
      // A run that ignores the in-flight refresh removes the lock here, and the
      // test fails on the next line — deterministically, with no reliance on
      // the race happening.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const waited = existsSync(lockDir(dir));

      // Let the refresh finish and the run finish with it, either way: leaving
      // the marker in place would strand a grandchild that keeps touching this
      // TMPDIR after the test has moved on.
      rmSync(marker);
      const result = await done;
      // The whole failure this test exists for, named as one assertion: a
      // "Directory not empty" release failure is a false failure for a command
      // that succeeded, and it leaves a lock behind for the next lane.
      expect({
        shell,
        waited,
        stderr: result.stderr,
        status: result.status,
      }).toEqual({
        shell,
        waited: true,
        stderr: "",
        status: 143,
      });
      expect(result.stdout).toContain("released by lane-a");
      expect(existsSync(lockDir(dir))).toBe(false);
      // The loop is a child of the run and the refresh a child of the loop:
      // nothing either of them left behind.
      await waitForDead(heartbeatPidOf(result.stdout));
    }
  }, 60_000);

  test("a lock deleted under it fails the run too, though the release has nothing to remove", () => {
    const dir = scratch();
    const result = runLockIn(dir, [
      "run",
      "lane-a",
      "--",
      "sh",
      "-c",
      'rm -rf "$TMPDIR/hexagen-gate.lock"',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("verify — no lock");
    expect(result.stderr).toContain("FAILED to release the lock");
  });

  test("a nested run is refused 75, never starts its command, and leaves no lock", () => {
    const dir = scratch();
    const marker = join(dir, "inner-ran");
    // Same host lock, so a nested run is not a second holder: it must lose
    // rather than deadlock or, worse, take the name from the run above it.
    const result = runLockIn(dir, [
      "run",
      "lane-a",
      "--",
      "sh",
      gateLock,
      "run",
      "lane-b",
      "--",
      "touch",
      marker,
    ]);
    expect(result.status).toBe(75);
    // The busy line is what tells a nested refusal from a command that merely
    // exited 75 — and it is on stderr, where a busy answer belongs.
    expect(result.stderr).toContain("busy");
    expect(result.stderr).toContain("lane-a");
    expect(existsSync(marker)).toBe(false);
    // The outer run still cleans up after itself.
    expect(existsSync(lockDir(dir))).toBe(false);
  }, 15_000);

  test("passes the command through quoted, and a -- inside it is just an argument", () => {
    // Under both shells, because `"$@"` is the shell's own and the two differ:
    // two arguments that contain spaces must arrive as two arguments, and the
    // -- that separates them must be the FIRST one only: read as a separator
    // again, the command would lose both.
    for (const shell of SIGNAL_SHELLS) {
      const dir = scratch();
      const out = join(dir, "args");
      const result = runLockIn(
        dir,
        [
          "run",
          "lane-a",
          "--",
          "sh",
          "-c",
          'printf "%s\\n" "$@" > "$TMPDIR/args"',
          "args",
          "--",
          "a b",
          "c d",
        ],
        {},
        15_000,
        shell,
      );
      expect({ shell, status: result.status }).toEqual({ shell, status: 0 });
      expect({
        shell,
        args: readFileSync(out, "utf8").trim().split("\n"),
      }).toEqual({
        shell,
        args: ["--", "a b", "c d"],
      });
    }
  }, 15_000);

  test("a missing -- or an empty command is a usage error, and takes no lock", () => {
    const dir = scratch();
    const noSeparator = runLockIn(dir, ["run", "lane-a", "true"]);
    expect(noSeparator.status).toBe(2);
    expect(noSeparator.stderr).toContain("usage");

    const empty = runLockIn(dir, ["run", "lane-a", "--"]);
    expect(empty.status).toBe(2);
    expect(empty.stderr).toContain("usage");

    const noLane = runLockIn(dir, ["run"]);
    expect(noLane.status).toBe(2);
    expect(noLane.stderr).toContain("usage");

    // A word where the separator belongs is a usage error, not a guess. The
    // separator used to be searched for, so everything before it was shifted
    // away in silence: `run lane-a extra -- sh -c … one two` started the
    // command with `two` and said nothing at all.
    const stray = runLockIn(dir, ["run", "lane-a", "extra", "--", "true"]);
    expect(stray.status).toBe(2);
    expect(stray.stderr).toContain("usage");

    // Nothing was locked on the way to the usage error.
    expect(existsSync(lockDir(dir))).toBe(false);
  });

  test("a run signalled between taking the lock and recording it still gives it back", async () => {
    const dir = scratch();
    // The window the test hook exists for: the lock is on disk and names this
    // run, but `run` has not yet recorded that it holds it. A signal here used
    // to leave the lock behind with a pid that was about to die — reclaimable
    // by the next lane, in the meantime, and never released by the only process
    // that could.
    const marker = join(dir, "paused-after-acquire");
    const { child, done } = startLockIn(
      dir,
      ["run", "lane-a", "--", "sleep", "30"],
      {
        HEXAGEN_GATE_TEST_PAUSE_AFTER_ACQUIRE: marker,
      },
    );
    await waitForFile(marker);
    expect(lockFile(dir, "owner").trim()).toBe("lane-a");
    expect(lockFile(dir, "pid").trim()).toBe(String(child.pid));
    process.kill(child.pid as number, "SIGTERM");
    rmSync(marker);

    const result = await done;
    expect(result.status).toBe(143);
    // No command was running under it — the command is started after this
    // window — so nothing else is holding the lock, and `run` is gone.
    expect(existsSync(lockDir(dir))).toBe(false);
  }, 15_000);

  test("a zero heartbeat interval is refused: a spin is not a heartbeat", () => {
    const dir = scratch();
    // `sleep 0` returns at once, so a zero interval is not a fast heartbeat —
    // it is no sleep at all: a loop forking a shell per iteration to write a
    // beat with the same second-resolution value. Measured over three seconds
    // of a run, 619 events in the lock directory at 0 against 6 at the intended
    // one-second tick.
    const result = runLockIn(dir, ["run", "lane-a", "--", "true"], {
      HEXAGEN_GATE_HEARTBEAT_SECONDS: "0",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("HEXAGEN_GATE_HEARTBEAT_SECONDS");
    expect(result.stderr).toContain("at least one second");
    // Refused before the acquire, on the same grounds as a non-numeric one.
    expect(existsSync(lockDir(dir))).toBe(false);
  });

  test("a non-numeric heartbeat interval is refused before the lock is taken", () => {
    const dir = scratch();
    const result = runLockIn(dir, ["run", "lane-a", "--", "true"], {
      HEXAGEN_GATE_HEARTBEAT_SECONDS: "soon",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("HEXAGEN_GATE_HEARTBEAT_SECONDS");
    // Refused before the acquire, not after: a run that took the lock and then
    // died on its own validation would leave a lock with no holder to release it.
    expect(existsSync(lockDir(dir))).toBe(false);
  });
});

/**
 * Slots, and one gate per worktree.
 *
 * HEXAGEN_GATE_SLOTS is a host-wide variable: every helper above pins it to 1
 * between the inherited environment and the per-test one, so a host that sets
 * it globally cannot change another test's result. The tests below set it
 * themselves, and the one that needs the variable ABSENT deletes it from a copy
 * of the environment, because a pinned helper could never show the default.
 *
 * Holders are seeded with a live pid (this process's) and their own worktree
 * identity; the caller is a fixed pid that nobody holds. Each caller runs from
 * its own scratch directory, whose realpath is the identity gate-lock computes
 * (a scratch directory is not inside a git repository).
 */
describe("the gate lock: slots and one gate per worktree", () => {
  const CALLER = { HEXAGEN_GATE_CALLER_PID: "434343" };

  /** A scratch directory that is a worktree identity of its own. */
  function worktree(): string {
    const dir = realpathSync(scratch());
    return dir;
  }

  function slotsEnv(n: number | string, extra: Record<string, string> = {}) {
    return { HEXAGEN_GATE_SLOTS: String(n), ...CALLER, ...extra };
  }

  test("HEXAGEN_GATE_SLOTS outside 1..64 or not an integer is refused with exit 2, naming the value", () => {
    for (const bad of ["0", "65", "", "abc", "2.5", "07", "-1", "999", " 2"]) {
      const dir = scratch();
      const result = runLockIn(dir, ["status"], { HEXAGEN_GATE_SLOTS: bad });
      expect(result.status, `value ${JSON.stringify(bad)}`).toBe(2);
      expect(result.stderr).toContain("HEXAGEN_GATE_SLOTS");
      expect(result.stderr).toContain(`: ${bad}`);
      expect(existsSync(lockDir(dir))).toBe(false);
    }
    for (const good of ["1", "2", "9", "10", "64"]) {
      const result = runLockIn(scratch(), ["status"], {
        HEXAGEN_GATE_SLOTS: good,
      });
      expect(result.status, `value ${good}`).toBe(0);
    }
  });

  test("a refused value never reaches an acquire: no lock is taken", () => {
    const dir = scratch();
    const result = runLockIn(dir, ["acquire", "lane-a"], slotsEnv(65));
    expect(result.status).toBe(2);
    expect(existsSync(lockDir(dir))).toBe(false);
  });

  test("with the variable absent there is exactly one slot, as before", () => {
    const dir = scratch();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TMPDIR: dir,
      HEXAGEN_GATE_CALLER_PID: String(process.pid),
    };
    delete env.HEXAGEN_GATE_SLOTS;
    const first = spawnSync("sh", [gateLock, "acquire", "lane-a"], {
      encoding: "utf8",
      env,
      cwd: worktree(),
    });
    expect(first.status).toBe(0);
    expect(first.stdout).not.toContain("slot");
    const second = spawnSync("sh", [gateLock, "acquire", "lane-b"], {
      encoding: "utf8",
      env: { ...env, HEXAGEN_GATE_CALLER_PID: "434344" },
      cwd: worktree(),
    });
    expect(second.status).toBe(75);
    expect(existsSync(slotDir(dir, 2))).toBe(false);
  });

  test("with N > 1 an acquirer takes the first free slot", () => {
    const dir = scratch();
    seedLock(dir, { owner: "lane-1", slot: 1, worktree: "/wt/one" });
    seedLock(dir, { owner: "lane-3", slot: 3, worktree: "/wt/three" });
    const result = runLockIn(
      dir,
      ["acquire", "lane-x"],
      slotsEnv(4),
      15_000,
      "sh",
      worktree(),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("slot 2");
    expect(readFileSync(join(slotDir(dir, 2), "owner"), "utf8").trim()).toBe(
      "lane-x",
    );
    expect(existsSync(slotDir(dir, 4))).toBe(false);
  });

  test("busy (75) only when every slot is held by a live holder", () => {
    const dir = scratch();
    seedLock(dir, { owner: "lane-1", slot: 1, worktree: "/wt/one" });
    seedLock(dir, { owner: "lane-2", slot: 2, worktree: "/wt/two" });
    const out = join(dir, "slot-out");
    const busy = runLockIn(
      dir,
      ["acquire", "lane-x"],
      slotsEnv(2, { HEXAGEN_GATE_SLOT_OUT: out }),
      15_000,
      "sh",
      worktree(),
    );
    expect(busy.status).toBe(75);
    expect(busy.stderr).toContain("busy");
    expect(existsSync(out)).toBe(false);
    expect(existsSync(slotDir(dir, 3))).toBe(false);
    // One more slot is free, and it is taken.
    const roomy = runLockIn(
      dir,
      ["acquire", "lane-x"],
      slotsEnv(3, { HEXAGEN_GATE_SLOT_OUT: out }),
      15_000,
      "sh",
      worktree(),
    );
    expect(roomy.status).toBe(0);
    expect(readFileSync(out, "utf8").trim()).toBe("3");
  });

  test("a dead holder's slot is reclaimed before the next slot is tried", () => {
    const dir = scratch();
    seedLock(dir, { owner: "lane-1", slot: 1, pid: reapedPid() });
    const result = runLockIn(
      dir,
      ["acquire", "lane-x"],
      slotsEnv(3),
      15_000,
      "sh",
      worktree(),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reclaiming");
    expect(readFileSync(join(slotDir(dir, 1), "owner"), "utf8").trim()).toBe(
      "lane-x",
    );
    expect(existsSync(slotDir(dir, 2))).toBe(false);
  });

  test("the slot-out file names the slot won, with one slot too", () => {
    const dir = scratch();
    const out = join(dir, "slot-out");
    const result = runLockIn(
      dir,
      ["acquire", "lane-a"],
      slotsEnv(1, { HEXAGEN_GATE_SLOT_OUT: out }),
      15_000,
      "sh",
      worktree(),
    );
    expect(result.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("1\n");
  });

  test("an acquire that cannot write the slot-out file is refused and gives its slot back", () => {
    const dir = scratch();
    const result = runLockIn(
      dir,
      ["acquire", "lane-a"],
      slotsEnv(2, { HEXAGEN_GATE_SLOT_OUT: join(dir, "no-such-dir", "out") }),
      15_000,
      "sh",
      worktree(),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("slot-out");
    expect(existsSync(slotDir(dir, 1))).toBe(false);
  });

  test("the slot records the worktree identity it was taken from", () => {
    const dir = scratch();
    const wt = worktree();
    const result = runLockIn(
      dir,
      ["acquire", "lane-a"],
      slotsEnv(2),
      15_000,
      "sh",
      wt,
    );
    expect(result.status).toBe(0);
    expect(readFileSync(join(slotDir(dir, 1), "worktree"), "utf8")).toBe(
      `${wt}\n`,
    );
  });

  test("a second live holder from the same worktree is refused 75 before the slot-out file is written, and its slot is gone", () => {
    const dir = scratch();
    const wt = worktree();
    seedLock(dir, { owner: "lane-1", slot: 1, worktree: wt });
    const out = join(dir, "slot-out");
    const result = runLockIn(
      dir,
      ["acquire", "lane-x"],
      slotsEnv(3, { HEXAGEN_GATE_SLOT_OUT: out }),
      15_000,
      "sh",
      wt,
    );
    expect(result.status).toBe(75);
    expect(result.stderr).toContain("same worktree");
    expect(result.stderr).not.toContain("busy —");
    expect(existsSync(out)).toBe(false);
    expect(existsSync(slotDir(dir, 2))).toBe(false);
    // The holder that was already there is untouched.
    expect(readFileSync(join(slotDir(dir, 1), "owner"), "utf8").trim()).toBe(
      "lane-1",
    );
  });

  test("a holder in another worktree does not block, and a dead one in this worktree does not either", () => {
    const dir = scratch();
    const wt = worktree();
    seedLock(dir, { owner: "lane-1", slot: 1, worktree: "/elsewhere" });
    const other = runLockIn(
      dir,
      ["acquire", "lane-x"],
      slotsEnv(2),
      15_000,
      "sh",
      wt,
    );
    expect(other.status).toBe(0);

    const dir2 = scratch();
    seedLock(dir2, {
      owner: "lane-2",
      slot: 2,
      worktree: wt,
      pid: reapedPid(),
    });
    const stale = runLockIn(
      dir2,
      ["acquire", "lane-x"],
      slotsEnv(2),
      15_000,
      "sh",
      wt,
    );
    expect(stale.status).toBe(0);
  });

  test("two gates started together in one worktree are never both admitted", async () => {
    const dir = scratch();
    const wt = worktree();
    const env = (n: string) =>
      slotsEnv(2, { HEXAGEN_GATE_HEARTBEAT_SECONDS: n });
    const a = startLockIn(
      dir,
      ["run", "lane-a", "--", "sleep", "2"],
      env("1"),
      "sh",
      wt,
    );
    const b = startLockIn(
      dir,
      ["run", "lane-b", "--", "sleep", "2"],
      env("1"),
      "sh",
      wt,
    );
    const [ra, rb] = await Promise.all([a.done, b.done]);
    expect(ra.status === 0 && rb.status === 0).toBe(false);
    for (const r of [ra, rb]) {
      if (r.status !== 0) expect(r.stderr).toContain("same worktree");
    }
  });

  test("two gates in two worktrees run side by side in two slots, each with its own slot-out", async () => {
    const dir = scratch();
    const outA = join(dir, "out-a");
    const outB = join(dir, "out-b");
    const a = startLockIn(
      dir,
      ["run", "lane-a", "--", "sleep", "3"],
      slotsEnv(2, { HEXAGEN_GATE_SLOT_OUT: outA }),
      "sh",
      worktree(),
    );
    await waitForContent(outA);
    const b = startLockIn(
      dir,
      ["run", "lane-b", "--", "true"],
      slotsEnv(2, { HEXAGEN_GATE_SLOT_OUT: outB }),
      "sh",
      worktree(),
    );
    const rb = await b.done;
    expect(rb.status).toBe(0);
    expect(readFileSync(outA, "utf8")).toBe("1\n");
    expect(readFileSync(outB, "utf8")).toBe("2\n");
    const ra = await a.done;
    expect(ra.status).toBe(0);
    expect(existsSync(slotDir(dir, 1))).toBe(false);
    expect(existsSync(slotDir(dir, 2))).toBe(false);
  });

  test("an empty worktree identity fails closed with exit 2 (the child removes its own cwd)", () => {
    for (const shell of SIGNAL_SHELLS) {
      const dir = scratch();
      const base = scratch();
      // The CHILD removes its cwd: a process spawned into a missing cwd fails
      // before any shell starts, which would test nothing here.
      const result = spawnSync(
        "sh",
        [
          "-c",
          'mkdir "$1/gone" && cd "$1/gone" && rmdir "$1/gone" && exec "$2" "$3" acquire lane-a',
          "sh",
          base,
          shell,
          gateLock,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HEXAGEN_GATE_SLOTS: "2",
            TMPDIR: dir,
            ...CALLER,
          },
        },
      );
      expect(result.status, shell).toBe(2);
      expect(result.stderr).toContain("worktree");
      expect(existsSync(slotDir(dir, 1))).toBe(false);
    }
  });

  test("a refused acquire gives its slot back only while the slot is still its own", async () => {
    const dir = scratch();
    const wt = worktree();
    seedLock(dir, { owner: "lane-1", slot: 1, worktree: wt });
    const pause = join(dir, "pause-drop");
    const refused = startLockIn(
      dir,
      ["acquire", "lane-x"],
      slotsEnv(2, { HEXAGEN_GATE_TEST_PAUSE_BEFORE_DROP: pause }),
      "sh",
      wt,
    );
    await waitForFile(pause);
    // In the window between the owner/pid check and the removal, the slot is
    // replaced by someone else's lock.
    rmSync(slotDir(dir, 2), { recursive: true, force: true });
    seedLock(dir, { owner: "lane-z", slot: 2, worktree: "/elsewhere" });
    rmSync(pause);
    const result = await refused.done;
    expect(result.status).toBe(75);
    expect(readFileSync(join(slotDir(dir, 2), "owner"), "utf8").trim()).toBe(
      "lane-z",
    );
    // The give-back says what it did instead of swallowing it.
    expect(result.stderr).toContain("removal aborted");
    // …and never claims a give-back that did not happen.
    expect(result.stderr).toContain("could not give slot 2 back");
    expect(result.stderr).not.toContain("slot 2 was given back");
    expect(readdirSync(dir).filter((n) => n.includes(".gone."))).toEqual([]);
  });

  test("a release re-checks owner and pid immediately before it removes: a replaced lock is left alone", async () => {
    const dir = scratch();
    seedLock(dir, { owner: "lane-a", pid: 434343 });
    const pause = join(dir, "pause-drop");
    const release = startLockIn(dir, ["release", "lane-a"], {
      ...CALLER,
      HEXAGEN_GATE_TEST_PAUSE_BEFORE_DROP: pause,
    });
    await waitForFile(pause);
    rmSync(lockDir(dir), { recursive: true, force: true });
    seedLock(dir, { owner: "lane-b" });
    rmSync(pause);
    const result = await release.done;
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("release refused");
    expect(lockFile(dir, "owner").trim()).toBe("lane-b");
    expect(readdirSync(dir).filter((n) => n.includes(".gone."))).toEqual([]);
  });

  test("release, verify and heartbeat find the caller's own slot, whichever it is", () => {
    const dir = scratch();
    seedLock(dir, { owner: "lane-1", slot: 1, pid: process.pid });
    seedLock(dir, { owner: "lane-a", slot: 2, pid: 434343 });
    const env = slotsEnv(2);
    expect(runLockIn(dir, ["verify", "lane-a"], env).status).toBe(0);
    expect(runLockIn(dir, ["verify", "lane-nobody"], env).status).toBe(1);
    const before = readFileSync(join(slotDir(dir, 2), "beat"), "utf8");
    expect(
      runLockIn(dir, ["heartbeat"], {
        ...env,
        HEXAGEN_GATE_STALE_SECONDS: "600",
      }).status,
    ).toBe(0);
    expect(readFileSync(join(slotDir(dir, 2), "beat"), "utf8")).not.toBe("");
    expect(before).not.toBe("");
    const released = runLockIn(dir, ["release", "lane-a"], env);
    expect(released.status).toBe(0);
    expect(existsSync(slotDir(dir, 2))).toBe(false);
    // The other holder's slot is never touched.
    expect(readFileSync(join(slotDir(dir, 1), "owner"), "utf8").trim()).toBe(
      "lane-1",
    );
  });

  test("status prints one line per slot when there is more than one", () => {
    const dir = scratch();
    seedLock(dir, { owner: "lane-1", slot: 1 });
    const result = runLockIn(dir, ["status"], { HEXAGEN_GATE_SLOTS: "3" });
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("slot 1: held by lane-1");
    expect(lines[1]).toContain("slot 2: free");
    expect(lines[2]).toContain("slot 3: free");
  });

  test("a contender that loses the name leaves no candidate nested inside the winner's lock", async () => {
    // `mv dir existing-dir` nests instead of failing: a loser's candidate
    // would land INSIDE the live lock and stay there.
    const dir = scratch();
    const pause = join(dir, "pause-mv");
    const loser = startLockIn(
      dir,
      ["acquire", "lane-loser"],
      slotsEnv(1, { HEXAGEN_GATE_TEST_PAUSE_BEFORE_MV: pause }),
      "sh",
      worktree(),
    );
    await waitForFile(pause);
    const winner = runLockIn(
      dir,
      ["acquire", "lane-winner"],
      { HEXAGEN_GATE_SLOTS: "1", HEXAGEN_GATE_CALLER_PID: String(process.pid) },
      15_000,
      "sh",
      worktree(),
    );
    expect(winner.status).toBe(0);
    rmSync(pause);
    const result = await loser.done;
    expect(result.status).toBe(75);
    expect(readdirSync(lockDir(dir)).sort()).toEqual([
      "beat",
      "owner",
      "pid",
      "started",
      "worktree",
    ]);
    expect(lockFile(dir, "owner").trim()).toBe("lane-winner");
    expect(readdirSync(dir).filter((n) => n.includes(".cand."))).toEqual([]);
  });

  test("a restore that finds the name taken in the last instant moves its copy back out and leaves it aside", async () => {
    const dir = scratch();
    seedLock(dir, { owner: "lane-a", pid: 434343 });
    const dropPause = join(dir, "pause-drop");
    const restorePause = join(dir, "pause-restore");
    const release = startLockIn(dir, ["release", "lane-a"], {
      ...CALLER,
      HEXAGEN_GATE_TEST_PAUSE_BEFORE_DROP: dropPause,
      HEXAGEN_GATE_TEST_PAUSE_IN_RESTORE: restorePause,
    });
    await waitForFile(dropPause);
    // The lock is replaced, so the removal moves it aside and must put it back…
    rmSync(lockDir(dir), { recursive: true, force: true });
    seedLock(dir, { owner: "lane-b" });
    rmSync(dropPause);
    await waitForFile(restorePause);
    // …and in the instant after it saw the name free, a third lock takes it.
    rmSync(lockDir(dir), { recursive: true, force: true });
    seedLock(dir, { owner: "lane-c" });
    rmSync(restorePause);
    const result = await release.done;
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("left at");
    expect(readdirSync(lockDir(dir)).sort()).toEqual([
      "beat",
      "owner",
      "pid",
      "started",
    ]);
    expect(lockFile(dir, "owner").trim()).toBe("lane-c");
    const aside = readdirSync(dir).filter((n) => n.includes(".gone."));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]!, "owner"), "utf8").trim()).toBe(
      "lane-b",
    );
  });

  test("a removal never deletes a saved lock that already sits at its aside name", async () => {
    // An earlier removal left a lock aside; the pid is reused, and the next
    // release must not delete it to make room for its own aside.
    const dir = scratch();
    seedLock(dir, { owner: "lane-a", pid: 434343 });
    const pause = join(dir, "pause-drop");
    const release = startLockIn(dir, ["release", "lane-a"], {
      ...CALLER,
      HEXAGEN_GATE_TEST_PAUSE_BEFORE_DROP: pause,
    });
    await waitForFile(pause);
    const pid = release.child.pid;
    for (const suffix of [`${pid}`, `${pid}.0`]) {
      const saved = `${lockDir(dir)}.gone.${suffix}`;
      mkdirSync(saved);
      writeFileSync(join(saved, "owner"), "lane-saved\n");
      writeFileSync(join(saved, "pid"), "1\n");
    }
    rmSync(pause);
    const result = await release.done;
    expect(result.status).toBe(0);
    expect(existsSync(lockDir(dir))).toBe(false);
    for (const suffix of [`${pid}`, `${pid}.0`]) {
      expect(
        readFileSync(
          join(`${lockDir(dir)}.gone.${suffix}`, "owner"),
          "utf8",
        ).trim(),
      ).toBe("lane-saved");
    }
  });

  test("a slot-out path that is a directory is refused: exit 2, the path named, the slot given back, nothing nested in it", () => {
    const dir = scratch();
    const out = join(dir, "out-is-a-dir");
    mkdirSync(out);
    const result = runLockIn(
      dir,
      ["acquire", "lane-a"],
      slotsEnv(2, { HEXAGEN_GATE_SLOT_OUT: out }),
      15_000,
      "sh",
      worktree(),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(out);
    expect(existsSync(slotDir(dir, 1))).toBe(false);
    expect(result.stderr).toContain("slot 1 was given back");
    expect(readdirSync(out)).toEqual([]);
  });
});
