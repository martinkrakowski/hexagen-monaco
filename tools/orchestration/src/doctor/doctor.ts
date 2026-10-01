import {
  CONFIG_RELATIVE_PATH,
  INVARIANT_NAMES,
  LOCKED_INVARIANTS,
  type Config,
  type ConfigDeprecation,
  type ConfigProblem,
} from "../internal/config.js";
import {
  CHECK_TIMEOUT_MS,
  type CheckStatus,
} from "../internal/capabilities.js";

/**
 * `hexagen-orchestration-doctor` — is this project actually set up to be
 * orchestrated?
 *
 * The tool answers one question with a yes or a no, and it is deliberately
 * unforgiving, because every one of its checks exists because something was
 * wrong and nobody found out until a gate ran and quietly did nothing.
 *
 * Four rules shape it:
 *
 * 1. **Name every failure, check all of them.** A doctor that stops at the
 *    first problem makes the operator fix them one at a time, and the ones
 *    behind it are the ones that were not obvious.
 * 2. **A check that could not look is not a pass.** An absent CI workflow is
 *    reported; so is a `gh` that is not installed, and a lane host whose
 *    `check` does not finish. "I could not check" and "it is fine" are
 *    different answers, and only one of them is a pass.
 * 3. **Absence is not failure, unless the tool needs the thing.** A project with
 *    no `laneHosts` is not broken — it simply has no host to check, so nothing
 *    is said about one. The absences that ARE reported are the ones that stop a
 *    check running: a lane host with no `check`, and a clone whose `user.email`
 *    could not be read because the ssh probe already failed. The one absence
 *    that IS a failure is the one the plan made so: the configured `ciWorkflow`,
 *    `.github/workflows/ci.yml` by default (OW-D5/B-1 gave that duty here when the
 *    template's `requires` was dropped; A-32 made the path configurable).
 * 4. **A WARN is a finding that never moves the exit code** (A-30). A
 *    deprecated setting, a host no seat dispatches through, and a clone whose
 *    `user.email` differs from this repository's are all worth saying out loud,
 *    and none of them is a reason to refuse a wave start.
 *
 * Every lane-host SUB-CHECK runs and is reported on its own, so a host whose
 * `dispatch[0]` is missing AND whose `check` fails reports both; only the
 * `user.email` read is ever skipped, and only because the ssh probe before it
 * already failed.
 *
 * `doctor` with `laneHosts` is a wave-START tool on the orchestrator's own host.
 * It is never a CI step: it probes hosts an operator runs.
 *
 * Every `overrides` entry is printed, including on success. An override is a
 * standing exception to a locked invariant; an exception nobody can see is not
 * one anybody is honouring.
 */

export const EXIT_HEALTHY = 0;
export const EXIT_UNHEALTHY = 1;
/** The overlay is not there at all — the one state that is not a diagnosis. */
export const EXIT_NO_CONFIG = 2;

/**
 * `warn` is reported and never affects the exit code (A-30). `info` is a fact
 * the operator should see and nothing is wrong with: it is never counted as a
 * problem or a warning either.
 */
export type Severity = "fail" | "skip" | "warn" | "info";

export interface Finding {
  readonly check: string;
  readonly severity: Severity;
  readonly message: string;
}

/** The capabilities `doctor` needs, injected so the tool is testable. */
export interface DoctorDeps {
  readonly exists: (path: string) => Promise<boolean>;
  /** Whether a command is on PATH. */
  readonly hasCommand: (command: string) => Promise<boolean>;
  /**
   * Whether a lane host's `dispatch[0]` is runnable. A relative `dispatch[0]`
   * is written relative to the repository, so the bin resolves it from the
   * root. Falls back to `hasCommand` when a caller has no such notion.
   */
  readonly hasDispatchCommand?: (command: string) => Promise<boolean>;
  /** Whether `git worktree` works, which is not the same as `git` existing. */
  readonly supportsWorktrees: () => Promise<boolean>;
  /**
   * Run a lane host's `check`: the one probe that says whether the host's own
   * dispatch path works. `timeout` is its own answer, not a failure.
   */
  readonly runCheck: (
    argv: readonly string[],
    timeoutMs: number,
  ) => Promise<CheckStatus>;
  /** Run a command on a remote host over ssh. */
  readonly runRemote: (
    alias: string,
    argv: readonly string[],
    timeoutMs: number,
  ) => Promise<{
    readonly status: CheckStatus;
    readonly stdout: string;
    /** ssh's last stderr line, when it wrote one. Optional for a caller with none. */
    readonly stderr?: string;
  }>;
  /**
   * This repository's own `user.email`, or `undefined`. It is compared against
   * the clone's, because a squash merge turns a host-local email into a public
   * `Co-authored-by` trailer.
   */
  readonly localUserEmail: () => Promise<string | undefined>;
  /**
   * The raw `HEXAGEN_GATE_SLOTS` this process sees, or `undefined` when it is
   * unset. Optional: a caller with no environment says nothing about it.
   */
  readonly gateSlots?: () => string | undefined;
}

/**
 * `HEXAGEN_GATE_SLOTS` as the gate lock will read it, as an INFO finding. The
 * variable is host-wide (never a config field), so doctor only reports it: an
 * unset one means the default of 1, and one the lock would refuse is said so
 * here rather than at the first gate.
 */
export function gateSlotsFinding(raw: string | undefined): Finding {
  const valid = raw !== undefined && /^([1-9]|[1-5][0-9]|6[0-4])$/.test(raw);
  const message =
    raw === undefined
      ? "HEXAGEN_GATE_SLOTS is unset: the gate lock has 1 slot (the default)."
      : valid
        ? `HEXAGEN_GATE_SLOTS=${raw}: the gate lock has ${raw} slot(s). More than one needs a test-worker cap (slots x maxWorkers <= threads); see the README's gate-lock section.`
        : `HEXAGEN_GATE_SLOTS=${JSON.stringify(raw)} is not an integer from 1 to 64, so the gate lock will refuse it (exit 2) until it is fixed.`;
  return { check: "gate-slots", severity: "info", message };
}

/**
 * The resolved `waveStatusPort` appearing in `forbiddenPorts` (A-20).
 *
 * This is not a hardcoded list of ports to refuse: refused ports come only
 * from the file. But a config that lists its OWN port among the ports the
 * server must refuse has made the server unstartable, and that is a mistake
 * worth naming rather than a rule this tool invented.
 */
export function checkStatusPort(config: Config): Finding | undefined {
  if (!config.forbiddenPorts.includes(config.waveStatusPort)) return undefined;
  return {
    check: "waveStatusPort",
    severity: "fail",
    message:
      `waveStatusPort ${config.waveStatusPort} also appears in forbiddenPorts ` +
      `[${config.forbiddenPorts.join(", ")}]. The status server would be required to ` +
      `refuse the port it binds. Remove it from forbiddenPorts, or set a different ` +
      `waveStatusPort.`,
  };
}

/** What one `check` or one ssh probe did NOT prove, in words an operator can act on. */
function howItFailed(status: CheckStatus): string {
  return status === "timeout"
    ? `did not finish within the ${CHECK_TIMEOUT_MS / 1_000} s check timeout`
    : "did not succeed";
}

/** ` ssh said: …` when ssh wrote something, so a failure says WHY, not only that. */
function sshSaid(stderr: string | undefined): string {
  return stderr === undefined || stderr === "" ? "" : ` ssh said: ${stderr}`;
}

/**
 * One lane host, in the order A-30 §3 fixes: `dispatch[0]` on PATH, then the ssh
 * probe on a remote host, then `check`, then the clone's `user.email`.
 *
 * Every sub-check runs and is reported independently. A host that is missing its
 * transport AND whose check fails must report both, because an operator who is
 * told about one of them will fix that one and run the tool again to find the
 * other.
 */
async function checkLaneHost(
  host: Config["laneHosts"][number],
  deps: DoctorDeps,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  const label = `lane-host ${host.name}`;
  const push = (severity: Severity, message: string): void => {
    findings.push({ check: label, severity, message });
  };

  const dispatch = host.dispatch[0];
  if (
    dispatch !== undefined &&
    !(await (deps.hasDispatchCommand ?? deps.hasCommand)(dispatch))
  ) {
    push(
      "fail",
      `dispatch[0] (${dispatch}) is not on PATH. It is the transport prefix every ` +
        `lane on this host is dispatched through, so no lane can run here until it is.`,
    );
  }

  // Side effect #1 of the two doctor has on a remote host.
  let reachable = false;
  if (host.ssh !== undefined) {
    const probe = await deps.runRemote(host.ssh, ["true"], CHECK_TIMEOUT_MS);
    reachable = probe.status === "ok";
    if (!reachable) {
      push(
        "fail",
        `the ssh probe \`ssh -n -o BatchMode=yes -o ConnectTimeout=5 ${host.ssh} true\` ` +
          `${howItFailed(probe.status)}.${sshSaid(probe.stderr)} It is how worktrees, briefs and ` +
          `fetch-back reach this host, and a lane cannot be sent to a host this tool cannot reach.`,
      );
    }
  }

  if (host.check === undefined) {
    push(
      "skip",
      "declares no `check`, so nothing here proved that this host can dispatch a lane.",
    );
  } else {
    const status = await deps.runCheck(host.check, CHECK_TIMEOUT_MS);
    if (status !== "ok") {
      push(
        "fail",
        `check ${JSON.stringify(host.check)} ${howItFailed(status)}. A check exercises ` +
          `the same path as the dispatch, so this is a lane that would fail to start ` +
          `rather than a cosmetic finding.`,
      );
    }
  }

  // Side effect #2, and the ONLY check that is ever skipped: an ssh probe that
  // already failed has established that the read cannot succeed, and a second
  // attempt would spend a second timeout on the same broken alias.
  if (host.ssh !== undefined && host.clone !== undefined) {
    if (!reachable) {
      push(
        "skip",
        "the clone's `user.email` was not read, because the ssh probe failed first.",
      );
    } else {
      const remote = await deps.runRemote(
        host.ssh,
        ["git", "-C", host.clone, "config", "user.email"],
        CHECK_TIMEOUT_MS,
      );
      const local = await deps.localUserEmail();
      if (remote.status !== "ok" || remote.stdout === "") {
        push(
          "skip",
          `the clone's \`user.email\` ${howItFailed(remote.status)}, so it could not be ` +
            `compared with this repository's.${sshSaid(remote.stderr)}`,
        );
      } else if (local === undefined || local === "") {
        push(
          "skip",
          "this repository has no `user.email`, so the clone's could not be compared with it.",
        );
      } else if (remote.stdout !== local) {
        push(
          "warn",
          `the clone's \`user.email\` is ${JSON.stringify(remote.stdout)} and this ` +
            `repository's is ${JSON.stringify(local)}. A squash merge turns a host-local ` +
            `email into a public \`Co-authored-by\` trailer, and the attribution invariant ` +
            `is off.`,
        );
      }
    }
  }

  return findings;
}

/**
 * Every check, run in order, with no early exit.
 *
 * The config's own shape problems come from `parseConfig`, so there is exactly
 * one implementation of the schema and `doctor` cannot drift from the loader.
 * `deprecations` rides beside them and is reported LAST, as WARN: a deprecated
 * setting still works, and a wave must not be blocked by a migration it can wait
 * for.
 */
export async function runDoctor(
  config: Config | undefined,
  problems: readonly ConfigProblem[],
  deprecations: readonly ConfigDeprecation[],
  configPresent: boolean,
  deps: DoctorDeps,
): Promise<{
  readonly findings: readonly Finding[];
  readonly exitCode: number;
}> {
  const findings: Finding[] = [];

  if (!configPresent || config === undefined) {
    findings.push({
      check: "config",
      severity: "fail",
      message:
        `no overlay at ${CONFIG_RELATIVE_PATH}. Run \`hexagen-orchestration-init\` to ` +
        `scaffold one.`,
    });
    // Nothing else can be judged without a config, and reporting a wall of
    // capability failures would bury the one thing that would fix them.
    return { findings, exitCode: EXIT_NO_CONFIG };
  }

  for (const problem of problems) {
    findings.push({
      check: "config",
      severity: "fail",
      message: `${problem.at} ${problem.message}`,
    });
  }

  // `repo` is what scopes wave-status, sweep and the log root to THIS project.
  // The loader has already tried `gh`; if it is still absent, nothing can name
  // the repository. A malformed `repo` is reported above, once, by the schema.
  if (
    config.repo === undefined &&
    !problems.some((problem) => problem.at === "repo")
  ) {
    findings.push({
      check: "repo",
      severity: "fail",
      message:
        `repo is not set in ${CONFIG_RELATIVE_PATH} and could not be derived. Set ` +
        `repo: owner/name, or make \`gh repo view --json nameWithOwner\` succeed here.`,
    });
  }

  const portFinding = checkStatusPort(config);
  if (portFinding !== undefined) findings.push(portFinding);

  // The configured `ciWorkflow` (A-32; OW-D5/B-1, and the red case review 3 asked for).
  if (!(await deps.exists(config.ciWorkflow))) {
    findings.push({
      check: "ci-workflow",
      severity: "fail",
      message:
        `${config.ciWorkflow} is missing from this project. The gate needs a workflow to ` +
        `run in. It is a capability check here rather than a template dependency ` +
        `precisely so a project that never had one is told so.`,
    });
  }

  for (const command of ["gh", "yarn"]) {
    if (!(await deps.hasCommand(command))) {
      findings.push({
        check: "capability",
        severity: "fail",
        message: `${command} is not on PATH.`,
      });
    }
  }

  if (!(await deps.supportsWorktrees())) {
    findings.push({
      check: "capability",
      severity: "fail",
      message:
        `git worktree is unavailable, or this is not a git repository. Waves are ` +
        `dispatched into worktrees, so without one a lane has nowhere to run.`,
    });
  }

  for (const host of config.laneHosts) {
    findings.push(...(await checkLaneHost(host, deps)));
  }

  if (deps.gateSlots !== undefined) {
    findings.push(gateSlotsFinding(deps.gateSlots()));
  }

  // A host no seat dispatches through still works: the orchestrator can name the
  // seat from `cast.md`. It is a WARN because the missing thing is the machine-
  // readable dispatch identity, and a dispatch identity nobody declared is an
  // identity that will be mistyped.
  const dispatched = new Set(config.seats.map((seat) => seat.host));
  for (const host of config.laneHosts) {
    if (dispatched.has(host.name)) continue;
    findings.push({
      check: `lane-host ${host.name}`,
      severity: "warn",
      message:
        `no seat dispatches through this host. Nothing in \`seats\` names ` +
        `${JSON.stringify(host.name)}, so the agent and model for a lane here have to ` +
        `come from \`cast.md\` instead. Declare the seat in \`seats\`.`,
    });
  }

  for (const deprecation of deprecations) {
    findings.push({
      check: "config",
      severity: "warn",
      message: `${deprecation.at} ${deprecation.message}`,
    });
  }

  return {
    findings,
    exitCode: findings.some((f) => f.severity === "fail")
      ? EXIT_UNHEALTHY
      : EXIT_HEALTHY,
  };
}

/** The locked invariants, for printing next to the overrides. */
export function lockedInvariants(): ReadonlyArray<readonly [string, unknown]> {
  return INVARIANT_NAMES.map(
    (name) => [name, LOCKED_INVARIANTS[name]] as const,
  );
}

/** What `doctor` printed, kept here so the bin stays a thin edge. */
export function formatReport(
  findings: readonly Finding[],
  config: Config | undefined,
): string {
  const lines: string[] = [];

  for (const finding of findings) {
    const label =
      finding.severity === "fail"
        ? "FAIL"
        : finding.severity === "warn"
          ? "WARN"
          : finding.severity === "info"
            ? "INFO"
            : "SKIP";
    lines.push(`${label}  [${finding.check}] ${finding.message}`);
  }

  if (config !== undefined) {
    lines.push("");
    lines.push(
      "Invariants (locked; change one only through an overrides[] entry):",
    );
    for (const [name, value] of lockedInvariants()) {
      const actual = config.invariants[name as keyof typeof config.invariants];
      const moved = actual !== value;
      lines.push(
        `  ${name}: ${JSON.stringify(actual)}${moved ? `  (locked default ${JSON.stringify(value)})` : ""}`,
      );
    }

    // Every override, always. On success too: an exception nobody can see is
    // not one anybody is honouring.
    lines.push("");
    if (config.overrides.length === 0) {
      lines.push("Overrides: none.");
    } else {
      lines.push(`Overrides (${config.overrides.length}):`);
      for (const override of config.overrides) {
        lines.push(`  ${override.invariant}: ${override.reason}`);
      }
    }
  }

  const failures = findings.filter((f) => f.severity === "fail").length;
  const warnings = findings.filter((f) => f.severity === "warn").length;
  lines.push("");
  if (failures === 0) {
    lines.push(
      `doctor: OK${warnings > 0 ? `, with ${warnings} warning(s) that do not affect this exit code` : ""}` +
        `${config?.overrides.length ? " (with the overrides above)" : ""}.`,
    );
  } else {
    lines.push(`doctor: ${failures} problem(s) to fix.`);
  }
  return lines.join("\n");
}
