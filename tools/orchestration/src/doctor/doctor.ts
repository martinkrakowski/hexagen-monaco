import {
  CONFIG_RELATIVE_PATH,
  INVARIANT_NAMES,
  LOCKED_INVARIANTS,
  type Config,
  type ConfigProblem,
} from "../internal/config.js";

/**
 * `hexagen-orchestration-doctor` — is this project actually set up to be
 * orchestrated?
 *
 * The tool answers one question with a yes or a no, and it is deliberately
 * unforgiving, because every one of its checks exists because something was
 * wrong and nobody found out until a gate ran and quietly did nothing.
 *
 * Three rules shape it:
 *
 * 1. **Name every failure, check all of them.** A doctor that stops at the
 *    first problem makes the operator fix them one at a time, and the ones
 *    behind it are the ones that were not obvious.
 * 2. **A check that could not look is not a pass.** An absent `ci.yml` is
 *    reported; so is a `gh` that is not installed, and an `opencodeServerUrl`
 *    that does not answer. "I could not check" and "it is fine" are different
 *    answers, and only one of them is a pass.
 * 3. **Absence is not failure, unless the tool needs the thing.** A project
 *    with no `opencodeServerUrl` is not broken — it simply has no server to
 *    probe, so the probe is skipped and that is reported as a skip, not a
 *    failure. The one absence that IS a failure is the one the plan made so:
 *    `.github/workflows/ci.yml` (OW-D5/B-1 gave that duty here when the
 *    template's `requires` was dropped).
 *
 * Every `overrides` entry is printed, including on success. An override is a
 * standing exception to a locked invariant; an exception nobody can see is not
 * one anybody is honouring.
 */

export const EXIT_HEALTHY = 0;
export const EXIT_UNHEALTHY = 1;
/** The overlay is not there at all — the one state that is not a diagnosis. */
export const EXIT_NO_CONFIG = 2;

export type Severity = "fail" | "skip";

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
  /** Whether `git worktree` works, which is not the same as `git` existing. */
  readonly supportsWorktrees: () => Promise<boolean>;
  /**
   * An HTTP reachability probe. `false` means "did not answer"; `{ redirect }`
   * means it answered with a redirect, which is reported and never followed.
   */
  readonly httpReachable: (
    url: string,
  ) => Promise<boolean | { readonly redirect: string }>;
}

const CI_WORKFLOW = ".github/workflows/ci.yml";

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

/** Whether a URL is a URL, as far as this tool needs. */
function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Every check, run in order, with no early exit.
 *
 * The config's own shape problems come from `parseConfig`, so there is exactly
 * one implementation of the schema and `doctor` cannot drift from the loader.
 */
export async function runDoctor(
  config: Config | undefined,
  problems: readonly ConfigProblem[],
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

  // `.github/workflows/ci.yml` (OW-D5/B-1, and the red case review 3 asked for).
  if (!(await deps.exists(CI_WORKFLOW))) {
    findings.push({
      check: "ci-workflow",
      severity: "fail",
      message:
        `${CI_WORKFLOW} is missing from this project. The gate needs a workflow to ` +
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

  if (config.opencodeServerUrl === undefined) {
    // Absent is not a failure, and saying so is the point: a project with no
    // server configured must not read as one whose server is broken.
    findings.push({
      check: "opencode-server",
      severity: "skip",
      message: "opencodeServerUrl is not set; skipping the reachability probe.",
    });
  } else if (!looksLikeUrl(config.opencodeServerUrl)) {
    findings.push({
      check: "opencode-server",
      severity: "fail",
      message: `opencodeServerUrl ${JSON.stringify(config.opencodeServerUrl)} is not an http or https URL.`,
    });
  } else {
    const probe = await deps.httpReachable(config.opencodeServerUrl);
    if (typeof probe === "object") {
      findings.push({
        check: "opencode-server",
        severity: "fail",
        message:
          `opencodeServerUrl ${config.opencodeServerUrl} answered with a redirect to ` +
          `${probe.redirect}. Redirects are not followed; set opencodeServerUrl to the final URL.`,
      });
    } else if (!probe) {
      findings.push({
        check: "opencode-server",
        severity: "fail",
        message: `opencodeServerUrl ${config.opencodeServerUrl} did not answer.`,
      });
    }
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
    const label = finding.severity === "fail" ? "FAIL" : "SKIP";
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
  lines.push("");
  if (failures === 0) {
    lines.push(
      `doctor: OK${config?.overrides.length ? " (with the overrides above)" : ""}.`,
    );
  } else {
    lines.push(`doctor: ${failures} problem(s) to fix.`);
  }
  return lines.join("\n");
}
