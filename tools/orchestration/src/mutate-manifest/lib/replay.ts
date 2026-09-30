import { runMutation } from "../../mutate/lib/mutate.js";
import type { MutationDeps } from "../../mutate/lib/types.js";
import type { Manifest, MutationCheck } from "./types.js";

export const EXIT_VERIFIED = 0;
export const EXIT_MISMATCH = 1;

/** Somewhere to put the literal texts so `runMutation` can read them the way it always does. */
export interface ScratchDeps {
  /** Creates a directory and returns its path. */
  readonly makeDir: () => Promise<string>;
  /** Writes `text` to `path`. */
  readonly writeText: (path: string, text: string) => Promise<void>;
  /** Removes the directory and everything in it. Called even when a mutation throws. */
  readonly removeDir: (path: string) => Promise<void>;
  /** Joins path segments. Injected so the tests need no filesystem at all. */
  readonly join: (...parts: readonly string[]) => string;
}

/**
 * Re-runs every mutation a manifest claims, and reports what actually happened.
 *
 * The literal texts are written to a scratch directory and handed to
 * `runMutation` as paths, so the engine that produced the original verdict is
 * the engine that checks it. A second implementation of "apply this mutation"
 * would be free to drift from the first, and the drift would look like
 * agreement.
 *
 * Every claim is checked against a baseline first — the same command, source
 * untouched. A suite that is already red fails on the baseline too, so without
 * it every claim would "reproduce" on a broken branch and the tool would
 * certify the very thing it exists to catch.
 */
export async function replayManifest(
  manifest: Manifest,
  deps: MutationDeps,
  scratch: ScratchDeps,
): Promise<readonly MutationCheck[]> {
  const dir = await scratch.makeDir();
  try {
    const checks: MutationCheck[] = [];
    for (const [index, mutation] of manifest.mutations.entries()) {
      // A retired claim is not run, and not silently dropped either. Its subject
      // is gone, so `runMutation` would refuse it (Rule 2) and — because a
      // manifest replays WHOLE — take every live claim in the file down with it.
      // Recording it as a check keeps the withdrawal in the output, where a
      // reader sees it every time rather than only if they open the JSON.
      if (mutation.retired !== undefined) {
        checks.push({ mutation, status: "retired" });
        continue;
      }
      const baseline = await deps.execute(mutation.command);
      if (baseline.launchError !== undefined) {
        checks.push({
          mutation,
          status: "launch-failure",
          launchError: baseline.launchError,
        });
        continue;
      }
      if (baseline.exitCode !== 0) {
        checks.push({ mutation, status: "red-baseline" });
        continue;
      }
      const beforePath = scratch.join(dir, `${index}.before`);
      const afterPath = scratch.join(dir, `${index}.after`);
      await scratch.writeText(beforePath, mutation.before);
      await scratch.writeText(afterPath, mutation.after);
      const result = await runMutation(
        {
          file: mutation.file,
          before: beforePath,
          after: afterPath,
          because: mutation.because,
          command: mutation.command,
        },
        deps,
      );
      if (result.launchError !== undefined) {
        checks.push({
          mutation,
          status: "launch-failure",
          launchError: result.launchError,
        });
        continue;
      }
      checks.push({
        mutation,
        status: result.verdict === mutation.verdict ? "verified" : "mismatch",
        observed: result.verdict,
      });
    }
    return checks;
  } finally {
    await scratch.removeDir(dir);
  }
}

export function formatChecks(
  lane: string,
  checks: readonly MutationCheck[],
): string {
  const lines: string[] = [];
  for (const check of checks) {
    const command = check.mutation.command.join(" ");
    if (check.status === "mismatch") {
      lines.push(
        `MISMATCH  ${check.mutation.file}`,
        `  claimed: ${check.mutation.verdict}    observed: ${check.observed}`,
        `  because: ${check.mutation.because}`,
        `  The lane reported a mutation its tests do not catch, so the test does`,
        `  not pin what the manifest says it pins.`,
      );
    } else if (check.status === "red-baseline") {
      lines.push(
        `RED BASELINE  ${check.mutation.file}`,
        `  command: ${command}`,
        `  because: ${check.mutation.because}`,
        `  The command already fails with the source untouched, so its exit code`,
        `  is not evidence about this mutation. A red suite is a finding about the`,
        `  branch, not about the manifest.`,
      );
    } else if (check.status === "launch-failure") {
      lines.push(
        `LAUNCH FAILURE  ${check.mutation.file}`,
        `  command: ${command}`,
        `  error: ${check.launchError}`,
        `  The command never ran, so there is no exit code to read either way.`,
      );
    } else if (check.status === "retired") {
      lines.push(
        `RETIRED  ${check.mutation.file}`,
        `  reason: ${check.mutation.retired}`,
        `  This claim was withdrawn and was not run. It is printed every replay`,
        `  so the withdrawal stays as visible as the claims that remain.`,
      );
    }
  }
  const bad = checks.filter((c) => c.status === "mismatch").length;
  const retired = checks.filter((c) => c.status === "retired").length;
  const blocked = checks.filter(
    (c) => c.status === "red-baseline" || c.status === "launch-failure",
  ).length;
  // Retired entries were never run, so counting them in "N mutation(s) re-run"
  // would report work that did not happen — the exact overstatement this tool
  // exists to stop.
  const ran = checks.length - retired;
  if (blocked > 0) {
    lines.push(
      `${lane}: ${blocked} of ${ran} mutation(s) could not be checked — see above.`,
    );
  } else if (ran === 0) {
    // Not "every verdict reproduced": nothing ran. A manifest with nothing left
    // to run is a finding about the manifest, and saying it plainly is the
    // difference between a gate and a green light.
    lines.push(
      `${lane}: all ${checks.length} mutation(s) are retired — this manifest now runs nothing.`,
    );
  } else {
    lines.push(
      bad === 0
        ? `${lane}: ${ran} mutation(s) re-run, every verdict reproduced.`
        : `${lane}: ${bad} of ${ran} mutation(s) did not reproduce.`,
    );
  }
  if (retired > 0) {
    lines.push(
      `${lane}: ${retired} mutation(s) retired with a stated reason, not run.`,
    );
  }
  return lines.join("\n");
}

export function exitCodeFor(checks: readonly MutationCheck[]): number {
  return checks.every((c) => c.status === "verified" || c.status === "retired")
    ? EXIT_VERIFIED
    : EXIT_MISMATCH;
}
