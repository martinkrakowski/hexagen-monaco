import type { Verdict } from "../../mutate/lib/types.js";

/**
 * One mutation a lane claims its tests catch, recorded so that anyone — a
 * reviewer, CI, a later reader — can re-run it instead of believing it.
 *
 * `before` and `after` are the literal texts, inline. They are small, and a
 * manifest that pointed at scratch files would stop being replayable the moment
 * those files were cleaned up, which is the day it matters.
 */
export interface ManifestMutation {
  readonly file: string;
  readonly before: string;
  readonly after: string;
  readonly because: string;
  readonly command: readonly string[];
  readonly verdict: Verdict;
  /**
   * Why this claim is no longer run. Absent on a live mutation.
   *
   * A mutation's subject can be *deleted* — not moved, not reformatted, gone.
   * There is then no text to re-anchor to, and the claim is neither broken nor
   * checkable: `runMutation` refuses zero-occurrence before-text (Rule 2), so
   * the entry can never replay again, and because a manifest is replayed WHOLE
   * it takes every other claim in the file down with it.
   *
   * Retiring is the honest way to say so, and it is itself a claim — which is
   * why the reason is required and a retired entry with an empty one is
   * refused. An unexplained retirement is indistinguishable from abandoning a
   * test that was catching something real. Everything else is kept: the file,
   * the texts, the command and the verdict stay as the historical record of
   * what was once proved. Only the running stops.
   */
  readonly retired?: string;
}

export interface Manifest {
  readonly version: 1;
  readonly lane: string;
  readonly mutations: readonly ManifestMutation[];
}

/**
 * `red-baseline` — the command already fails with the source untouched, so its
 * exit code says nothing about the mutation. `launch-failure` — the command
 * never ran at all. Both are findings about the branch under test, not about
 * the claim, and neither is a verdict. `retired` — the claim was withdrawn with
 * a stated reason and deliberately not run; it is counted and printed rather
 * than dropped, so a retirement stays visible every time the manifest replays.
 */
export type CheckStatus =
  | "verified"
  | "mismatch"
  | "red-baseline"
  | "launch-failure"
  | "retired";

export interface MutationCheck {
  readonly mutation: ManifestMutation;
  readonly status: CheckStatus;
  /** Absent unless the mutation actually ran: a blocked check observes nothing. */
  readonly observed?: Verdict;
  /** Set only with `launch-failure` — why there was no exit code to read. */
  readonly launchError?: string;
}
