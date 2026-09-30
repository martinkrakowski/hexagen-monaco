import type {
  Premise,
  PremiseResult,
  PremiseStatus,
  VerifyDeps,
} from "../../internal/premise-types.js";
import { errorText } from "../../internal/artifact.js";

export const EXIT_ALL_HOLD = 0;
export const EXIT_STALE_FOUND = 1;
export const EXIT_TIMED_OUT = 2;

/**
 * How long a premise may run before the executor kills it. A premise is a
 * grep or a test — one that hangs is a bug in the premise, and without a
 * ceiling it would stop every lane checked after it.
 */
export const PREMISE_TIMEOUT_MS = 10_000;

export async function verifyPremises(
  premises: readonly Premise[],
  deps: VerifyDeps,
): Promise<readonly PremiseResult[]> {
  const results: PremiseResult[] = [];
  for (const premise of premises) {
    try {
      const { exitCode, output, timedOut } = await deps.execute(premise.script);
      const status: PremiseStatus =
        timedOut === true ? "timed-out" : exitCode === 0 ? "holds" : "stale";
      const trimmed = output.trim();
      results.push({
        premise,
        status,
        exitCode,
        output,
        ...(status !== "holds" && trimmed !== "" ? { reason: trimmed } : {}),
      });
    } catch (err: unknown) {
      const message = errorText(err);
      results.push({
        premise,
        status: "error",
        exitCode: 1,
        output: message,
        reason: message,
      });
    }
  }
  return results;
}

/**
 * The stale lines come first and say what to do, because the whole point is
 * that a stale premise is read before a lane is dispatched against it.
 */
export function formatReport(results: readonly PremiseResult[]): string {
  const stale = results.filter((r) => r.status === "stale");
  const timedOut = results.filter((r) => r.status === "timed-out");
  const error = results.filter((r) => r.status === "error");
  const lines: string[] = [];
  for (const r of stale) {
    lines.push(
      `STALE  ${r.premise.lane}  (${r.premise.plan})`,
      `  the premise exited ${r.exitCode}: the gap this lane describes is already closed.`,
      `  Do not dispatch it. Re-read the code, then amend or withdraw the lane.`,
    );
    if (r.output !== "") lines.push(`  ${r.output.split("\n").join("\n  ")}`);
  }
  for (const r of timedOut) {
    lines.push(
      `TIMED-OUT  ${r.premise.lane}  (${r.premise.plan})`,
      `  the premise was killed after ${PREMISE_TIMEOUT_MS}ms: no verdict on this lane.`,
      `  Not stale — the lane may still be live. Make the premise decide quickly.`,
    );
    if (r.output !== "") lines.push(`  ${r.output.split("\n").join("\n  ")}`);
  }
  for (const r of error) {
    lines.push(
      `ERROR  ${r.premise.lane}  (${r.premise.plan})`,
      `  the premise could not be checked: ${r.output}`,
    );
  }
  const held = results.length - stale.length - timedOut.length - error.length;
  if (stale.length > 0 || timedOut.length > 0 || error.length > 0)
    lines.push("");
  lines.push(
    stale.length === 0 && timedOut.length === 0 && error.length === 0
      ? `${held} premise(s) hold; no lane is stale.`
      : [
          ...(stale.length > 0 ? [`${stale.length} stale`] : []),
          ...(timedOut.length > 0 ? [`${timedOut.length} timed out`] : []),
          ...(error.length > 0 ? [`${error.length} error`] : []),
          `${held} holding`,
        ].join(", ") + ".",
  );
  return lines.join("\n");
}

/**
 * A timed-out premise or executor error exits non-zero too — a check that could
 * not decide did not pass. Stale wins when both appear because it is the
 * actionable verdict.
 */
export function exitCodeFor(results: readonly PremiseResult[]): number {
  if (results.some((r) => r.status === "stale")) return EXIT_STALE_FOUND;
  if (results.some((r) => r.status === "timed-out" || r.status === "error"))
    return EXIT_TIMED_OUT;
  return EXIT_ALL_HOLD;
}
