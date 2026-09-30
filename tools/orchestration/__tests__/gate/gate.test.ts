import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * The gate's run loop. Every test drives the real `bin/gate-run.sh` with a
 * `HEXAGEN_GATE_STEPS` list (one `name<TAB>command` line per step) and a fresh
 * TMPDIR, so no test runs the real suite and no test ever touches the real
 * lock.
 *
 * The loop has NO step list and NO locked names of its own — those come from
 * the bin, which reads the overlay — so the behaviours pinned here are the ones
 * that survive that split: the lock covers exactly the names the bin marked
 * locked; a failing step releases it and leaves no heartbeat process; a
 * coverage threshold failure fails the gate even when the step's own tool exits
 * 0; a skipped step is reported and counted rather than passed; busy propagates
 * as 75.
 */

const gateRunSh = fileURLToPath(
  new URL("../../bin/gate-run.sh", import.meta.url),
);

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "hexagen-gate-run-"));
  dirs.push(dir);
  return dir;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  /** The TMPDIR this run's lock lived under. */
  dir: string;
}

function stepsEnv(entries: Array<[string, string]>): Record<string, string> {
  return {
    HEXAGEN_GATE_STEPS: entries
      .map(([name, cmd]) => `${name}\t${cmd}`)
      .join("\n"),
  };
}

/** The lock's names, in the leading-and-trailing-space form the loop matches on. */
function lockedEnv(names: readonly string[]): Record<string, string> {
  return {
    HEXAGEN_GATE_LOCKED: names.length === 0 ? " " : ` ${names.join(" ")} `,
  };
}

/** The skip reasons, one `name<TAB>reason` line per skipped step. */
function skipEnv(entries: Array<[string, string]>): Record<string, string> {
  return {
    HEXAGEN_GATE_SKIP: entries
      .map(([name, why]) => `${name}\t${why}`)
      .join("\n"),
  };
}

function runGate(
  args: string[],
  env: Record<string, string | undefined> = {},
  timeout = 15_000,
): RunResult {
  const dir = scratch();
  const childEnv: NodeJS.ProcessEnv = { ...process.env, TMPDIR: dir };
  for (const [key, value] of Object.entries(env)) {
    // An explicit `undefined` DELETES the variable from the child's
    // environment, including one inherited from this process — which is how a
    // test asks "what does the loop do when the bin passed nothing?" rather
    // than "what does an empty value do?". Assigning `undefined` would not
    // delete an inherited value.
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const result = spawnSync("sh", [gateRunSh, ...args], {
    encoding: "utf8",
    env: childEnv,
    timeout,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    dir,
  };
}

/** Seeds a live, fresh lock into the given TMPDIR, as another lane would hold it. */
function seedBusyLock(dir: string, owner = "lane-a"): string {
  const lock = join(dir, "hexagen-gate.lock");
  mkdirSync(lock, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(join(lock, "owner"), `${owner}\n`);
  writeFileSync(join(lock, "started"), `${now}\n`);
  writeFileSync(join(lock, "pid"), `${process.pid}\n`);
  writeFileSync(join(lock, "beat"), `${now}\n`);
  return lock;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Run the loop without waiting for it — for tests that race its boundaries. */
function runGateAsyncIn(
  dir: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [gateRunSh, ...args], {
      env: { ...process.env, TMPDIR: dir, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ status: code ?? -1, stdout, stderr, dir }),
    );
  });
}

/** Poll until the path exists — the handshake for the script's test pauses. */
async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function heartbeatPidOf(stdout: string): number {
  const match = /gate: heartbeat pid (\d+)/.exec(stdout);
  if (!match) throw new Error(`no heartbeat pid line in:\n${stdout}`);
  return Number(match[1]);
}

describe("the gate run loop", () => {
  test("parses as POSIX sh", () => {
    const result = spawnSync("sh", ["-n", gateRunSh], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("parses under dash too, when the host has it", () => {
    if (!existsSync("/bin/dash")) return;
    const result = spawnSync("/bin/dash", ["-n", gateRunSh], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("an unset or empty HEXAGEN_GATE_STEPS is refused, and it names the variable", () => {
    // The loop has no default step list of its own — a gate that supplied one
    // would be a second source of truth for the same thing — so with nothing
    // injected it must refuse rather than run nothing and report green.
    // A usable list is inherited from this process, so the unset case is only
    // unset if the helper truly deletes it from the child's environment.
    vi.stubEnv("HEXAGEN_GATE_STEPS", "build\ttrue");
    const unset = runGate(["--lane", "lane-b"], {
      HEXAGEN_GATE_STEPS: undefined,
    });
    vi.unstubAllEnvs();
    expect(unset.status).toBe(2);
    expect(unset.stderr).toContain("HEXAGEN_GATE_STEPS");

    const empty = runGate(["--lane", "lane-b"], { HEXAGEN_GATE_STEPS: "" });
    expect(empty.status).toBe(2);
    expect(empty.stderr).toContain("HEXAGEN_GATE_STEPS");
    // Never a green run, never a tally.
    expect(unset.stdout).not.toContain("steps passed");
    expect(empty.stdout).not.toContain("steps passed");
  });

  test("a busy lock makes the gate exit 75 and leaves the holder's lock alone", () => {
    const dir = scratch();
    const lock = seedBusyLock(dir, "lane-a");
    const r = runGate(["--lane", "lane-b"], {
      TMPDIR: dir,
      ...lockedEnv(["test:cov"]),
      ...stepsEnv([["test:cov", "true"]]),
    });
    expect(r.status).toBe(75);
    expect(r.stderr).toContain("busy");
    expect(r.stderr).toContain("lane-a");
    expect(readFileSync(join(lock, "owner"), "utf8").trim()).toBe("lane-a");
  });

  test("the lock is not held during build, and is held during the locked steps", () => {
    const r = runGate(["--lane", "lane-b"], {
      ...lockedEnv(["test:cov", "verify-manifests"]),
      ...stepsEnv([
        ["build", 'test ! -d "$TMPDIR/hexagen-gate.lock"'],
        ["test:cov", 'test -d "$TMPDIR/hexagen-gate.lock"'],
        ["verify-manifests", 'test -d "$TMPDIR/hexagen-gate.lock"'],
      ]),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("<== build: exit 0");
    expect(r.stdout).toContain("<== test:cov: exit 0");
    expect(r.stdout).toContain("<== verify-manifests: exit 0");
    // The lock is released as soon as the last locked step passes.
    expect(existsSync(join(r.dir, "hexagen-gate.lock"))).toBe(false);
    expect(r.stdout).toContain("gate: lock released, heartbeat stopped");
    expect(r.stdout).toContain("heartbeat pid");
  });

  test("only the names the bin marked locked take the lock, whatever they are called", () => {
    // The lock follows `locked`, never a name: a step called `test:cov` that
    // the bin did not mark locked must run WITHOUT it, and a step called
    // anything at all that it did mark must run WITH it.
    const r = runGate(["--lane", "lane-b"], {
      ...lockedEnv(["arch:inventory"]),
      ...stepsEnv([
        ["test:cov", 'test ! -d "$TMPDIR/hexagen-gate.lock"'],
        ["arch:inventory", 'test -d "$TMPDIR/hexagen-gate.lock"'],
      ]),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("<== test:cov: exit 0");
    expect(r.stdout).toContain("<== arch:inventory: exit 0");
  });

  test("a failing locked step releases the lock and leaves no heartbeat process", () => {
    const r = runGate(["--lane", "lane-b"], {
      ...lockedEnv(["test:cov"]),
      ...stepsEnv([["test:cov", 'sh -c "exit 3"']]),
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("FAILED at step 'test:cov' (exit 3)");
    expect(existsSync(join(r.dir, "hexagen-gate.lock"))).toBe(false);
    const hb = heartbeatPidOf(r.stdout);
    expect(isAlive(hb)).toBe(false);
  });

  test("a coverage threshold failure fails the gate even when the step exits 0", () => {
    // The scan is name-agnostic, so this step is called `build` — the source
    // keyed its scan on a step called `test:cov`, which is a rename away from
    // passing over a genuine coverage failure.
    const r = runGate(
      ["--lane", "lane-b"],
      stepsEnv([
        [
          "build",
          'printf "ERROR: Coverage for statements does not meet global threshold\\n"',
        ],
      ]),
    );
    expect(r.status).toBe(1);
    // The real exit code is printed even though the gate fails on the scan.
    expect(r.stdout).toContain("<== build: exit 0");
    expect(r.stdout).toContain("ERROR: Coverage");
    expect(r.stderr).toContain("coverage threshold failure");
    expect(r.stderr).toContain("step 'build'");
    expect(existsSync(join(r.dir, "hexagen-gate.lock"))).toBe(false);
  });

  test("the gate stops at the first failing step by name, and later steps never run", () => {
    const dir = scratch();
    const marker = join(dir, "later-ran");
    const r = runGate(["--lane", "lane-b"], {
      TMPDIR: dir,
      ...stepsEnv([
        ["lint", "true"],
        ["typecheck", 'sh -c "exit 2"'],
        ["lint:bytes", `touch ${marker}`],
      ]),
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("<== lint: exit 0");
    expect(r.stdout).toContain("<== typecheck: exit 2");
    expect(r.stderr).toContain("FAILED at step 'typecheck' (exit 2)");
    expect(existsSync(marker)).toBe(false);
  });

  test("the heartbeat refreshes the beat while the lock is held", () => {
    const r = runGate(
      ["--lane", "lane-b"],
      {
        HEXAGEN_GATE_HEARTBEAT_SECONDS: "1",
        ...lockedEnv(["test:cov", "verify-manifests"]),
        ...stepsEnv([
          // The fake step holds the lock for a deliberate 2s so a 1s tick must
          // land inside it; date +%s makes anything shorter flaky at second
          // granularity. The 15s timeout is calibrated to that hold, not
          // raised to hide a flake.
          ["test:cov", "sleep 2"],
          [
            "verify-manifests",
            'test "$(cat "$TMPDIR/hexagen-gate.lock/beat")" -gt "$(cat "$TMPDIR/hexagen-gate.lock/started")"',
          ],
        ]),
      },
      15_000,
    );
    expect(r.status).toBe(0);
  });

  test("a lock lost during a locked step fails the gate as lock lost", () => {
    // The step removes the lock out from under the gate; the heartbeat's next
    // tick fails, the loop dies leaving its marker, and the boundary check
    // after the step must fail the gate — not release a phantom and go green.
    const r = runGate(
      ["--lane", "lane-b"],
      {
        HEXAGEN_GATE_HEARTBEAT_SECONDS: "1",
        ...lockedEnv(["test:cov"]),
        ...stepsEnv([
          ["test:cov", 'rm -rf "$TMPDIR/hexagen-gate.lock"; sleep 2'],
        ]),
      },
      15_000,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lock lost after step 'test:cov'");
    expect(existsSync(join(r.dir, "hexagen-gate.lock"))).toBe(false);
  }, 15_000);

  test("a lock replaced by another holder fails the gate as lock lost, and the replacement survives cleanup", () => {
    // The reclaim scenario end to end: the lock is replaced by a fresh holder
    // while the gate is mid-step. The gate must fail as lock lost, and its
    // cleanup must leave the replacement's lock exactly as it found it.
    const dir = scratch();
    const lock = join(dir, "hexagen-gate.lock");
    const replace = [
      'rm -rf "$TMPDIR/hexagen-gate.lock"',
      'mkdir "$TMPDIR/hexagen-gate.lock"',
      'printf "lane-c\\n" > "$TMPDIR/hexagen-gate.lock/owner"',
      `printf "${process.pid}\\n" > "$TMPDIR/hexagen-gate.lock/pid"`,
      'printf "$(date +%s)\\n" > "$TMPDIR/hexagen-gate.lock/started"',
      'printf "$(date +%s)\\n" > "$TMPDIR/hexagen-gate.lock/beat"',
      "sleep 2",
    ].join("; ");
    const r = runGate(
      ["--lane", "lane-b"],
      {
        TMPDIR: dir,
        HEXAGEN_GATE_HEARTBEAT_SECONDS: "1",
        ...lockedEnv(["test:cov"]),
        ...stepsEnv([["test:cov", replace]]),
      },
      15_000,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lock lost after step 'test:cov'");
    expect(readFileSync(join(lock, "owner"), "utf8").trim()).toBe("lane-c");
    expect(existsSync(lock)).toBe(true);
  }, 15_000);

  test("a lock lost between locked steps fails the gate at the next step's boundary", async () => {
    // The pause hook holds the gate before each locked step; the handshake
    // removes the lock in exactly the between-steps window the check covers.
    const dir = scratch();
    const marker = join(dir, "paused-before-step");
    const pending = runGateAsyncIn(dir, ["--lane", "lane-b"], {
      ...lockedEnv(["test:cov", "verify-manifests"]),
      ...stepsEnv([
        ["test:cov", "true"],
        ["verify-manifests", "true"],
      ]),
      HEXAGEN_GATE_TEST_PAUSE_BEFORE_STEP: marker,
    });
    await waitForFile(marker);
    rmSync(marker);
    await waitForFile(marker);
    rmSync(join(dir, "hexagen-gate.lock"), { recursive: true, force: true });
    rmSync(marker);
    const r = await pending;
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lock lost before step 'verify-manifests'");
    expect(existsSync(join(dir, "hexagen-gate.lock"))).toBe(false);
  }, 15_000);

  test("a failed release is reported by the gate, which does not report green", () => {
    // The last locked step makes the lock directory read-only, so the gate's
    // release cannot remove it: the gate must report the failed release and
    // exit non-zero, never print the tally over a lingering lock.
    const dir = scratch();
    const lock = join(dir, "hexagen-gate.lock");
    const r = runGate(
      ["--lane", "lane-b"],
      {
        TMPDIR: dir,
        ...lockedEnv(["test:cov", "verify-manifests"]),
        ...stepsEnv([
          ["test:cov", "true"],
          ["verify-manifests", 'chmod 555 "$TMPDIR/hexagen-gate.lock"'],
        ]),
      },
      15_000,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAILED to release the lock");
    expect(r.stdout).not.toContain("steps passed");
    expect(existsSync(lock)).toBe(true);
    // Let the cleanup remove the scratch dir again.
    chmodSync(lock, 0o755);
  }, 15_000);

  test("a run where every step passes prints the full tally", () => {
    const r = runGate(
      ["--lane", "lane-b"],
      stepsEnv([
        ["lint", "true"],
        ["lint:bytes", "true"],
      ]),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gate: 2/2 steps passed");
  });

  test("a skipped step is reported and counted, never passed", () => {
    // The step is STILL in the list — the tally's denominator is every step the
    // bin resolved — and its command must not run.
    const dir = scratch();
    const marker = join(dir, "skipped-ran");
    const r = runGate(["--lane", "lane-b"], {
      TMPDIR: dir,
      ...stepsEnv([
        ["build", "true"],
        ["check:env", `touch ${marker}`],
        ["lint", "true"],
      ]),
      ...skipEnv([["check:env", "no check:env script in package.json"]]),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "SKIPPED check:env (no check:env script in package.json)",
    );
    // No `==>` for a step that did not run, and it did not run.
    expect(r.stdout).not.toContain("==> [2/3]");
    expect(existsSync(marker)).toBe(false);
    // Two passed, one skipped, out of three.
    expect(r.stdout).toContain("gate: 2/3 steps passed, 1 skipped");
    expect(r.stdout).not.toContain("gate: 3/3 steps passed");
  });

  test("a skipped locked step never takes the lock, and never holds it open", () => {
    const r = runGate(["--lane", "lane-b"], {
      ...lockedEnv(["test:cov", "verify-manifests"]),
      ...stepsEnv([
        // The skipped locked step. Were it ever run, or were it to acquire, the
        // probe below would find the lock.
        ["test:cov", 'touch "$TMPDIR/skipped-ran"'],
        // Not locked, and between the two: if the skip had taken the lock this
        // is where it would be visible. The lock must not exist yet.
        [
          "probe",
          'test ! -d "$TMPDIR/hexagen-gate.lock" && touch "$TMPDIR/no-lock-at-probe"',
        ],
        // The next locked step acquires for itself, so the lock exists while
        // it runs.
        [
          "verify-manifests",
          'test -d "$TMPDIR/hexagen-gate.lock" && touch "$TMPDIR/lock-held-during"',
        ],
      ]),
      ...skipEnv([["test:cov", "no test:cov script in package.json"]]),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("SKIPPED test:cov");
    expect(r.stdout).toContain("<== verify-manifests: exit 0");
    expect(r.stdout).toContain("gate: 2/3 steps passed, 1 skipped");
    expect(existsSync(join(r.dir, "skipped-ran"))).toBe(false);
    expect(existsSync(join(r.dir, "no-lock-at-probe"))).toBe(true);
    expect(existsSync(join(r.dir, "lock-held-during"))).toBe(true);
    // Released after the last locked step that ran, not held open.
    expect(existsSync(join(r.dir, "hexagen-gate.lock"))).toBe(false);
  });

  test("locked names match whole names: foo and bar locked, foo-bar is not", () => {
    const r = runGate(["--lane", "lane-b"], {
      ...lockedEnv(["foo", "bar"]),
      ...stepsEnv([
        ["foo", 'test -d "$TMPDIR/hexagen-gate.lock"'],
        ["foo-bar", 'test ! -d "$TMPDIR/hexagen-gate.lock"'],
      ]),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gate: 2/2 steps passed");
  });

  test("an unknown flag exits 2, and so does a --lane without a value", () => {
    const unknown = runGate(["--wat"], stepsEnv([["build", "true"]]));
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("usage");

    const missing = runGate(["--lane"], stepsEnv([["build", "true"]]));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("missing value for --lane");
  });

  test("an invalid lane id is refused", () => {
    const r = runGate(["--lane", "bad lane!"], stepsEnv([["build", "true"]]));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("invalid lane id");
  });

  test("a malformed step list is refused before step one", () => {
    const noCommand = runGate(["--lane", "lane-b"], stepsEnv([["build", ""]]));
    expect(noCommand.status).toBe(2);
    expect(noCommand.stderr).toContain("has no command");
    // Refused, not run: nothing was executed before the shape was checked.
    expect(noCommand.stdout).not.toContain("==>");

    const whitespace = runGate(["--lane", "lane-b"], {
      HEXAGEN_GATE_STEPS: "\n\n",
    });
    expect(whitespace.status).toBe(2);
    expect(whitespace.stderr).toContain("HEXAGEN_GATE_STEPS");
    expect(whitespace.stdout).not.toContain("steps passed");
  });

  test("a non-numeric heartbeat interval is refused", () => {
    const r = runGate(["--lane", "lane-b"], {
      HEXAGEN_GATE_HEARTBEAT_SECONDS: "soon",
      ...stepsEnv([["build", "true"]]),
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("HEXAGEN_GATE_HEARTBEAT_SECONDS");
  });
});
