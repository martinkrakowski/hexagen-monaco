import { afterEach, describe, expect, test } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHECK_TIMEOUT_MS,
  hasCommand,
  runCheck,
  runRemote,
  shellQuote,
  STDERR_LINE_MAX,
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

  test("a NUL byte in the name is false, not a throw", async () => {
    expect(await hasCommand("no\u0000pe")).toBe(false);
  });

  test("a name is never interpreted as shell", async () => {
    expect(await hasCommand("node; echo pwned")).toBe(false);
  });

  test("a relative command resolves against the cwd option", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestration-has-cwd-"));
    dirs.push(dir);
    const script = join(dir, "probe");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o755);
    expect(await hasCommand("./probe", process.env, { cwd: dir })).toBe(true);
    expect(await hasCommand("./probe", process.env)).toBe(false);
  });
});

/**
 * Whether a pid is still a RUNNING process.
 *
 * `kill(pid, 0)` answers "does the pid exist", and a killed process whose parent
 * has not reaped it yet still does: it is a zombie (state `Z`), dead in every way
 * this suite cares about. After a group SIGKILL the runner has already re-raised
 * and exited, so the dead probe is an orphan of whatever PID 1 or subreaper the
 * host has, and any ancestor or PID 1 that reaps late under load keeps it in the
 * table. That zombie path is one of two known sources of a "survived" failure in
 * the Ctrl-C test; the other is a slow SIGINT dispatch (see that test). On Linux the state is read from `/proc/<pid>/stat`; ESRCH, a vanished
 * proc entry, and `Z`/`X` all mean gone. Elsewhere (macOS has no procfs, and its
 * launchd reaps at once) `kill(pid, 0)` is the whole answer.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== "linux") return true;
  try {
    // The state is the first field after the `(comm)` one, and comm may itself
    // contain spaces or parens, so anchor on the LAST `)`.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(
      stat.lastIndexOf(")") + 2,
      stat.lastIndexOf(")") + 3,
    );
    return state !== "Z" && state !== "X";
  } catch (error) {
    // The proc entry vanished between the two calls: gone. Reading the stat of a
    // process that is exiting mid-read can also give ESRCH rather than ENOENT.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH") return false;
    // Anything else (an unreadable procfs) proves nothing, and `kill(pid, 0)`
    // already said the pid exists: report alive, so the group-kill tests cannot
    // pass without checking anything.
    return true;
  }
}

/** The fields after the last `)` of /proc/<pid>/stat, as a printable summary. */
function procSummary(pid: number | undefined): string {
  if (pid === undefined || !Number.isFinite(pid)) return "unknown pid";
  if (process.platform !== "linux") return "no procfs on this platform";
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return `state ${f[0]}, ppid ${f[1]}, pgrp ${f[2]}, session ${f[3]}`;
  } catch {
    return "gone";
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

  test("a NUL byte in a word is failed, not a synchronous throw", async () => {
    expect(await runCheck(["a\u0000b"])).toBe("failed");
    expect(await runCheck(["true", "a\u0000b"])).toBe("failed");
  });

  test("an empty argv is failed, because there is nothing to run", async () => {
    expect(await runCheck([])).toBe("failed");
  });

  test("argv is never interpreted by a shell", async () => {
    // `test 1 -eq "1; true"` is false, so this is `failed`. Through a shell it
    // would be `test 1 -eq 1; true`, which is 0, and the answer would be `ok`.
    expect(await runCheck(["test", "1", "-eq", "1; true"])).toBe("failed");
  });

  test("a relative command resolves against the cwd option", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestration-cwd-"));
    dirs.push(dir);
    const script = join(dir, "probe");
    writeFileSync(script, "#!/bin/sh\nexit 0\n");
    chmodSync(script, 0o755);
    expect(await runCheck(["./probe"], 5_000, { cwd: dir })).toBe("ok");
    expect(await runCheck(["./probe"], 5_000)).toBe("failed");
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
      // Generous on purpose: under the suite's process-spawn load the shell can
      // take well over a few hundred ms to fork and write the pidfile, and a
      // timeout that fires first reads as a missing pidfile, not a survivor.
      2_000,
    );
    expect(status).toBe("timeout");

    expect(
      existsSync(pidfile),
      "the shell had not forked within timeoutMs",
    ).toBe(true);
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

describe("Ctrl-C does not leave a detached probe running", () => {
  test("SIGINT to the process running runCheck kills the probe's grandchild", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestration-sigint-"));
    dirs.push(dir);
    const pidfile = join(dir, "grandchild.pid");
    const script = join(dir, "runner.mjs");
    const capabilities = pathToFileURL(
      resolve(import.meta.dirname, "../../src/internal/capabilities.ts"),
    ).href;
    // The probe's shell forks a grandchild and waits, in its OWN group: only the
    // tracked-group kill on SIGINT can reach the grandchild.
    writeFileSync(
      script,
      [
        `import { runCheck } from ${JSON.stringify(capabilities)};`,
        `await runCheck(["sh", "-c", 'sleep 30 & echo "$$ $!" > "$0"; wait', ${JSON.stringify(pidfile)}], 30_000);`,
        "",
      ].join("\n"),
    );
    const runner = spawn(
      process.execPath,
      ["--experimental-strip-types", script],
      { stdio: "ignore" },
    );
    let grandchild: number | undefined;
    let shell: number | undefined;
    try {
      // Generous, and guarded: a slow fork is not a survivor.
      const deadline = Date.now() + 8_000;
      while (!existsSync(pidfile) && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 20));
      }
      expect(existsSync(pidfile), "the probe had not forked in time").toBe(
        true,
      );
      // The pidfile exists before its content is flushed; wait for a number.
      while (Date.now() < deadline) {
        const text = readFileSync(pidfile, "utf8").trim();
        if (text !== "") break;
        await new Promise((done) => setTimeout(done, 20));
      }
      // The probe writes "<shell pid> <grandchild pid>"; wait for both.
      let parts: string[] = [];
      while (Date.now() < deadline) {
        parts = readFileSync(pidfile, "utf8").trim().split(/\s+/);
        if (parts.length >= 2) break;
        await new Promise((done) => setTimeout(done, 20));
      }
      shell = Number.parseInt(parts[0] ?? "", 10);
      grandchild = Number.parseInt(parts[1] ?? "", 10);
      expect(
        Number.isFinite(grandchild) && Number.isFinite(shell),
        "the probe recorded its shell and grandchild pids",
      ).toBe(true);
      const sentAt = Date.now();
      expect(runner.kill("SIGINT")).toBe(true);
      // Two known ways to fail here, and neither is a product contract on
      // latency: a zombie not yet reaped (handled in `alive`), and a runner whose
      // event loop is slow to dispatch SIGINT under CI load, so the grandchild is
      // genuinely alive in state S for longer than 2 s. A 2 s kill latency is not
      // a product contract, so the window matches the 8 s fork allowance.
      //
      // Reading a failure (the message carries the evidence):
      //  - state Z: a zombie, i.e. reaping latency.
      //  - state S, ppid == the shell, the runner still alive: the handler had
      //    not dispatched, i.e. latency.
      //  - state S, ppid 1 or another reaper, the shell gone: the group kill
      //    missed the grandchild, i.e. a product bug.
      const died = await waitForDeath(grandchild, 8_000);
      expect(
        died,
        [
          `grandchild ${grandchild} survived Ctrl-C: the detached group was never killed`,
          `grandchild: ${procSummary(grandchild)}`,
          `shell ${shell}: ${procSummary(shell)}`,
          `runner exitCode=${runner.exitCode} signalCode=${runner.signalCode}`,
          `elapsed since SIGINT: ${Date.now() - sentAt} ms`,
        ].join("\n"),
      ).toBe(true);
    } finally {
      runner.kill("SIGKILL");
      if (grandchild !== undefined && Number.isFinite(grandchild)) {
        try {
          process.kill(grandchild, "SIGKILL");
        } catch {
          // Already gone, which is the point.
        }
      }
    }
  }, 45_000); // 8 s fork + 8 s death + slack: at least 5 s above the waits.
});

describe("runRemote, the real runner", () => {
  test("a NUL byte in a word is failed, not a synchronous throw", async () => {
    const result = await runRemote("alias", ["a\u0000b"], 5_000);
    expect(result.status).toBe("failed");
  });

  test("an alias that cannot resolve is failed, not a throw or a hang", async () => {
    const alias = `hexagen-no-such-host-${Math.random().toString(36).slice(2)}`;
    // A resolver that answers NXDOMAIN at once gives `failed`; one that stalls
    // gives `timeout`. Both are a bounded answer, and a host that took longer
    // than the bound is the only wrong result.
    const started = Date.now();
    const result = await runRemote(alias, ["true"], 5_000);
    expect(["failed", "timeout"]).toContain(result.status);
    expect(result.stdout).toBe("");
    expect(Date.now() - started).toBeLessThan(10_000);
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

/**
 * Security: `ssh` joins the remote argv with spaces and the remote login shell
 * PARSES the result. These run a REAL `sh`, because whether a string is one
 * word is a fact about a shell, not something to reason out.
 */
describe("shellQuote, evaluated by a real sh", () => {
  /** The words `sh` sees when it evaluates `printf '%s\n' <quoted>`. */
  const words = (quoted: string): string[] =>
    execFileSync("sh", ["-c", `printf '%s\\n' ${quoted}`], {
      encoding: "utf8",
    })
      .split("\n")
      .slice(0, -1);

  test.each(["a b", "; rm -rf x", "$(id)", "it's", "`id`", "a'b'c", "*", ""])(
    "%j comes back as exactly one literal word",
    (word) => {
      expect(words(shellQuote(word))).toEqual([word]);
    },
  );

  test("an injection through a clone path is one word, not a command", () => {
    const clone = "/srv/cf; echo pwned";
    expect(words(["git", "-C", clone].map(shellQuote).join(" "))).toEqual([
      "git",
      "-C",
      clone,
    ]);
  });
});

describe("runRemote quotes what reaches the remote shell", () => {
  test("an argv word carrying shell syntax arrives as one literal word", async () => {
    // A fake `ssh` that behaves like the real one where it matters: it drops
    // the six arguments runRemote puts before the remote argv (-n, two -o pairs, alias)
    // and hands the REST, joined with spaces, to a shell.
    const dir = mkdtempSync(join(tmpdir(), "orchestration-ssh-"));
    dirs.push(dir);
    const fake = join(dir, "ssh");
    writeFileSync(fake, '#!/bin/sh\nshift 6\nexec /bin/sh -c "$*"\n');
    chmodSync(fake, 0o755);
    const result = await runRemote(
      "alias",
      ["printf", "%s\\n", "a b", "; echo pwned", "$(echo pwned)", "it's"],
      5_000,
      { sshCommand: fake },
    );
    expect(result.status).toBe("ok");
    expect(result.stdout.split("\n")).toEqual([
      "a b",
      "; echo pwned",
      "$(echo pwned)",
      "it's",
    ]);
  }, 20_000);

  test("ssh's last non-empty stderr line is surfaced, trimmed and capped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestration-ssh-"));
    dirs.push(dir);
    const fake = join(dir, "ssh");
    writeFileSync(
      fake,
      "#!/bin/sh\necho 'warning: first' >&2\necho '  Permission denied (publickey).  ' >&2\necho >&2\nexit 255\n",
    );
    chmodSync(fake, 0o755);
    const result = await runRemote("alias", ["true"], 5_000, {
      sshCommand: fake,
    });
    expect(result.status).toBe("failed");
    expect(result.stderr).toBe("Permission denied (publickey).");

    const long = join(dir, "ssh-long");
    writeFileSync(
      long,
      `#!/bin/sh\nprintf '%s\\n' ${"x".repeat(500)} >&2\nexit 255\n`,
    );
    chmodSync(long, 0o755);
    const capped = await runRemote("alias", ["true"], 5_000, {
      sshCommand: long,
    });
    expect(capped.stderr).toHaveLength(STDERR_LINE_MAX);
  }, 20_000);

  test("it settles on close, so stdout written just before exit is not lost", async () => {
    // The fake exits at once while a forked writer still holds stdout open and
    // prints a moment later. `exit` would settle with an empty stdout; `close`
    // waits for the pipe to end, which is what a probe that READS stdout needs.
    const dir = mkdtempSync(join(tmpdir(), "orchestration-ssh-"));
    dirs.push(dir);
    const fake = join(dir, "ssh");
    writeFileSync(fake, "#!/bin/sh\n(sleep 0.3; echo late-value) &\nexit 0\n");
    chmodSync(fake, 0o755);
    const result = await runRemote("alias", ["true"], 5_000, {
      sshCommand: fake,
    });
    expect(result.status).toBe("ok");
    expect(result.stdout).toBe("late-value");
  }, 20_000);
});
