import { execFile, spawn } from "node:child_process";

/**
 * Whether a command is on PATH, without running it.
 *
 * `command` is a POSIX shell BUILTIN, and `execFile` runs no shell, so
 * `execFile("command", ...)` only works on a host that happens to ship a
 * `/usr/bin/command` shim (macOS does; Ubuntu does not). The probe therefore
 * goes through `/bin/sh`, which every POSIX host has at that path, and the
 * name travels as a positional parameter rather than being spliced into the
 * script, so a name is never interpreted as shell.
 *
 * `env` is a parameter so a test can hand it a PATH with no `command` shim in
 * it, which is what a Linux runner looks like.
 */
export function hasCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "/bin/sh",
      ["-c", 'command -v "$1"', "sh", command],
      { env },
      (error) => resolve(error === null),
    );
  });
}

/**
 * What one probe of a lane host found (A-30 §1.1).
 *
 * Three outcomes, not two, because "the check did not finish" is not "the check
 * passed" and a doctor that reports those as the same answer reports a host that
 * has stopped answering as a host that is working.
 */
export type CheckStatus = "ok" | "failed" | "timeout";

/**
 * The ceiling on one `check` or one ssh probe.
 *
 * Ten seconds: long enough for a tunnel to open on demand, which is the dispatch
 * path's steady state rather than residue, and short enough that a wave start
 * does not sit on a host that will never answer.
 */
export const CHECK_TIMEOUT_MS = 10_000;

/** The options every probe here runs under. No shell, and its own process group. */
const SPAWN_BASE = {
  // No shell, always: argv is the transport prefix from the overlay, and a shell
  // would give a host declaration a second, invisible grammar.
  shell: false,
  // `detached` makes the child the leader of a NEW process group, so a negative
  // pid below reaches every descendant instead of only the process this module
  // happened to spawn. A check that opens a tunnel forks that tunnel; killing
  // the group is the difference between a bounded probe and a residue per run.
  detached: true,
} as const;

/**
 * Kill a probe's whole process group, and never throw for a group that is gone.
 *
 * The race is real: between the timer firing and this call the child can exit,
 * and `kill(-pid)` on a reaped group raises ESRCH. A group that is already gone
 * is the outcome the timeout wanted.
 */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/**
 * Run a lane host's `check`, and report whether the DISPATCH PATH works.
 *
 * Three things about this are load-bearing:
 *
 * - `detached: true`, so a timeout kills the whole group and a `-f`-forked tunnel
 *   that inherited this process's fds goes with it.
 * - it settles on the child's **`exit`**, not `close`. A forked tunnel holds the
 *   inherited stdout open, so `close` would wait for a writer that is never going
 *   to exit and report a working host as a timeout, forever.
 * - a spawn failure is `failed`, not a throw. `dispatch[0]` not being on PATH is
 *   `doctor`'s job to report, and this is the seam it reports it through.
 */
export function runCheck(
  argv: readonly string[],
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<CheckStatus> {
  const [command, ...args] = argv;
  if (command === undefined) return Promise.resolve("failed");
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...SPAWN_BASE, stdio: "ignore" });
    let settled = false;
    const timer = setTimeout(() => {
      killGroup(child.pid);
      settle("timeout");
    }, timeoutMs);
    const settle = (status: CheckStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    child.on("error", () => settle("failed"));
    child.on("exit", (code) => settle(code === 0 ? "ok" : "failed"));
  });
}

/** What one command on a remote host found, and what it printed. */
export interface RemoteResult {
  readonly status: CheckStatus;
  /** Trimmed stdout. The email read needs the value; nothing else does. */
  readonly stdout: string;
}

/**
 * Run a command on a remote host over ssh.
 *
 * `ssh -n` (no stdin, so a probe can never wait on a prompt), `BatchMode=yes`
 * (no password prompt, so a missing key is an answer rather than a hang) and
 * `ConnectTimeout=5` bound the CONNECTION. None of them bounds what happens
 * after it: DNS, and auth, both outlive `ConnectTimeout`, which is why the whole
 * thing is bounded again by `timeoutMs`.
 *
 * The remote argv travels as separate arguments. `ssh` joins them with spaces
 * on the far side, which is what makes `git -C <clone> config user.email` work,
 * and it means nothing here is ever interpreted by a local shell.
 */
export function runRemote(
  alias: string,
  argv: readonly string[],
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<RemoteResult> {
  return new Promise((resolve) => {
    const child = spawn(
      "ssh",
      ["-n", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", alias, ...argv],
      { ...SPAWN_BASE, stdio: ["ignore", "pipe", "ignore"] },
    );
    let settled = false;
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    const timer = setTimeout(() => {
      killGroup(child.pid);
      settle("timeout");
    }, timeoutMs);
    const settle = (status: CheckStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout: stdout.trim() });
    };
    child.on("error", () => settle("failed"));
    child.on("exit", (code) => settle(code === 0 ? "ok" : "failed"));
  });
}
