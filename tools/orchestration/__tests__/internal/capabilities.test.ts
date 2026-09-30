import { afterEach, describe, expect, test } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHECK_TIMEOUT_MS,
  hasCommand,
  runCheck,
  runRemote,
} from "../../src/internal/capabilities.js";

/**
 * Two things are being held here.
 *
 * F6: `doctor` reported `gh` and `yarn` missing on every Linux runner, because
 * `command` is a shell builtin and `execFile` runs no shell. macOS ships a
 * `/usr/bin/command` shim, which is the only reason it ever worked here. These
 * tests run the REAL probe; the third removes the shim from the picture by
 * giving the probe a PATH that holds exactly one executable.
 *
 * A-30: `runCheck` is how doctor learns whether a lane host can dispatch at all,
 * and its timeout is the only thing standing between a wave start and a residue
 * per host per run. The timeout test therefore runs the REAL runner against a
 * process that FORKS: a mocked timeout proves the return value and nothing about
 * the kill, and the kill is the whole point.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("hasCommand, un-injected", () => {
  test("is true for node", async () => {
    expect(await hasCommand("node")).toBe(true);
  });

  test("is false for a name nothing is called", async () => {
    const name = `hexagen-no-such-cmd-${Math.random().toString(36).slice(2)}`;
    expect(await hasCommand(name)).toBe(false);
  });

  test("finds a command on a PATH that has no `command` shim (a Linux host)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestration-path-"));
    dirs.push(dir);
    const file = join(dir, "hexagen-fake-gh");
    writeFileSync(file, "#!/bin/sh\nexit 0\n");
    chmodSync(file, 0o755);
    const env = { PATH: dir };
    expect(await hasCommand("hexagen-fake-gh", env)).toBe(true);
    expect(await hasCommand("hexagen-fake-yarn", env)).toBe(false);
  });

  test("a name is never interpreted as shell", async () => {
    expect(await hasCommand("node; echo pwned")).toBe(false);
  });
});

/** Whether a pid still exists. ESRCH is how a kernel says it does not. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until `pid` is gone, so the assertion is not a race with the kill. */
async function waitForDeath(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((done) => setTimeout(done, 20));
  }
  return !alive(pid);
}

describe("runCheck, the real runner", () => {
  test("a command that exits 0 is ok", async () => {
    expect(await runCheck(["true"])).toBe("ok");
  });

  test("a command that exits non-zero is failed", async () => {
    expect(await runCheck(["false"])).toBe("failed");
  });

  test("a command that does not exist is failed, not a throw", async () => {
    const name = `hexagen-no-such-cmd-${Math.random().toString(36).slice(2)}`;
    expect(await runCheck([name])).toBe("failed");
  });

  test("an empty argv is failed, because there is nothing to run", async () => {
    expect(await runCheck([])).toBe("failed");
  });

  test("argv is never interpreted by a shell", async () => {
    // `test 1 -eq "1; true"` is false, so this is `failed`. Through a shell it
    // would be `test 1 -eq 1; true`, which is 0, and the answer would be `ok`.
    expect(await runCheck(["test", "1", "-eq", "1; true"])).toBe("failed");
  });

  test("CHECK_TIMEOUT_MS is the 10 s ceiling A-30 §3 fixes", () => {
    expect(CHECK_TIMEOUT_MS).toBe(10_000);
  });

  test("F-A30: the timeout kills the whole group, so a forked grandchild dies too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestration-kill-"));
    dirs.push(dir);
    const pidfile = join(dir, "grandchild.pid");
    // `sh -c` forks a grandchild that outlives the shell on its own: `wait` is
    // what keeps the shell alive, and SIGKILL to the shell alone would leave the
    // grandchild holding this pid.
    const status = await runCheck(
      ["sh", "-c", 'sleep 30 & echo $! > "$0"; wait', pidfile],
      250,
    );
    expect(status).toBe("timeout");

    const pid = Number.parseInt(readFileSync(pidfile, "utf8").trim(), 10);
    expect(Number.isFinite(pid), "the grandchild recorded its own pid").toBe(
      true,
    );
    expect(
      await waitForDeath(pid, 2_000),
      `grandchild ${pid} survived the timeout: the group kill reached only the shell`,
    ).toBe(true);
  }, 20_000);
});

describe("runRemote, the real runner", () => {
  test("an alias that cannot resolve is failed, not a throw or a hang", async () => {
    const alias = `hexagen-no-such-host-${Math.random().toString(36).slice(2)}`;
    const result = await runRemote(alias, ["true"], 5_000);
    expect(result.status).toBe("failed");
    expect(result.stdout).toBe("");
  }, 20_000);

  test("the probe is bounded: an unroutable alias times out rather than waiting on DNS", async () => {
    // `ConnectTimeout=5` does not bound DNS, which is why the whole thing is
    // bounded again from here. The status is the claim; the elapsed time is the
    // proof that the bound is real and not nominal.
    const started = Date.now();
    const result = await runRemote(
      "hexagen-no-such-host.invalid",
      ["true"],
      750,
    );
    expect(["timeout", "failed"]).toContain(result.status);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);
});
