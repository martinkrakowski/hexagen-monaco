export const ARCH_VALIDATE_JSON_SCHEMA_VERSION = 1;

export type ArchValidateStatus = "compliant" | "violations" | "could-not-run";

export interface LintCounts {
  fresh: number;
  expired: number;
  baselineGrowth: number;
  filesScanned: number | null;
}

export interface ArchValidateOutcome {
  status: ArchValidateStatus;
  exitCode: 0 | 1 | 2;
  counts: LintCounts | null;
  reason: string | null;
}

/** Last stdout line that starts with "{", parsed. null when absent, unparseable, not an object, or missing any of the three arrays. */
export function parseLintJsonLine(stdout: string): LintCounts | null {
  let lastObjectLine: string | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trimStart().startsWith("{")) {
      lastObjectLine = line;
    }
  }
  if (lastObjectLine === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastObjectLine);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (
    !Array.isArray(obj.fresh) ||
    !Array.isArray(obj.expired) ||
    !Array.isArray(obj.baselineGrowth)
  ) {
    return null;
  }

  const filesScanned = obj.filesScanned;
  if (filesScanned !== null) {
    if (typeof filesScanned !== "number" || !Number.isInteger(filesScanned) || filesScanned <= 0) {
      return null;
    }
  }

  return {
    fresh: obj.fresh.length,
    expired: obj.expired.length,
    baselineGrowth: obj.baselineGrowth.length,
    filesScanned: filesScanned as number | null,
  };
}

/**
 * linterExit: the child's numeric exit code, or null when it did not exit on its own
 * (timeout or signal). json: whether `--json` was passed to the linter.
 */
export function classifyLintRun(
  linterExit: number | null,
  stdout: string,
  json: boolean,
): ArchValidateOutcome {
  if (linterExit === null) {
    return {
      status: "could-not-run",
      exitCode: 2,
      counts: null,
      reason: "hexagen-lint did not exit on its own (timeout or signal)",
    };
  }

  if (linterExit === 0) {
    if (json) {
      const counts = parseLintJsonLine(stdout);
      if (counts === null) {
        return {
          status: "could-not-run",
          exitCode: 2,
          counts: null,
          reason: "hexagen-lint exited 0 but printed no readable JSON line",
        };
      }
      return { status: "compliant", exitCode: 0, counts, reason: null };
    }
    return { status: "compliant", exitCode: 0, counts: null, reason: null };
  }

  if (linterExit === 1) {
    const counts = json ? parseLintJsonLine(stdout) : null;
    return { status: "violations", exitCode: 1, counts, reason: null };
  }

  return {
    status: "could-not-run",
    exitCode: 2,
    counts: null,
    reason: "hexagen-lint exited " + String(linterExit),
  };
}

export function linterNotFoundOutcome(): ArchValidateOutcome {
  return {
    status: "could-not-run",
    exitCode: 2,
    counts: null,
    reason: "arch-linter not found — install @hexagen-monaco/arch-linter",
  };
}

export function toArchValidateJson(outcome: ArchValidateOutcome): string {
  return JSON.stringify({
    schemaVersion: ARCH_VALIDATE_JSON_SCHEMA_VERSION,
    command: "arch validate",
    status: outcome.status,
    exitCode: outcome.exitCode,
    fresh: outcome.counts?.fresh ?? null,
    expired: outcome.counts?.expired ?? null,
    baselineGrowth: outcome.counts?.baselineGrowth ?? null,
    filesScanned: outcome.counts?.filesScanned ?? null,
    reason: outcome.reason,
  });
}
