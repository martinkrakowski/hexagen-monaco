import { repoFlag, type RepoRef } from "./types.js";
import { errorText, fetchAllThreads } from "./sweep.js";

/**
 * The question `bin/merge-prs` asks immediately before `gh pr merge`:
 * may this PR merge, on the head whose checks were read green?
 *
 * The decision lives here, in TypeScript, and not in that script, for one
 * reason: the decision has to be tested, and the gate that runs the tests has
 * no zsh. A condition written in a language CI cannot run is a condition only
 * the operator's memory enforces — which is how a script comes to implement
 * less than the stage it belongs to.
 */
export interface MergeGatePlan {
  readonly pr: number;
  /** The head whose check-runs were read green. The merge must be about THIS commit. */
  readonly head: string;
}

export type MergeGateDecision =
  | { readonly kind: "merge"; readonly summary: string }
  | { readonly kind: "refuse"; readonly reasons: readonly string[] };

export interface MergeGateDeps {
  readonly gh: (args: readonly string[]) => Promise<string>;
  /** The one repository every call is pointed at. */
  readonly repo: RepoRef;
}

/**
 * Two conditions, both decided from what the forge answers:
 *
 * 1. **Zero unresolved review threads** — every page of them. An open thread is
 *    a finding nobody has dispositioned, and each one is named by its first
 *    comment's author and an excerpt so the operator can find it without
 *    opening the PR.
 * 2. **The head is still the one that was verified.** A push landing after the
 *    check read moved the merge target; merging anyway ships a commit no check
 *    has looked at, which is the race the whole stage exists to close.
 *
 * Anything that could not be decided is a refusal, never a pass: the gate's
 * job is to be sure, and "I could not tell" is not sure.
 */
export async function mergeGate(
  plan: MergeGatePlan,
  deps: MergeGateDeps,
): Promise<MergeGateDecision> {
  const fetched = await fetchAllThreads(plan.pr, deps.gh, deps.repo);
  // A page that could not be read is not a PR with no threads — it is a PR
  // whose threads were never seen. Say so, and stop.
  if (fetched.failures.length > 0) {
    return {
      kind: "refuse",
      reasons: [
        `could not decide — the review threads of PR #${plan.pr} could not be read: ${fetched.failures.join("; ")}`,
      ],
    };
  }
  if (fetched.prId === undefined) {
    return {
      kind: "refuse",
      reasons: [
        `could not decide — PR #${plan.pr} is not readable, so its threads are unknown`,
      ],
    };
  }

  const open = fetched.threads.filter((t) => !t.isResolved);
  if (open.length > 0) {
    return {
      kind: "refuse",
      reasons: open.map(
        (t) => `${t.id}: unresolved — ${t.author}: "${t.excerpt}"`,
      ),
    };
  }

  let head: string;
  try {
    head = (
      await deps.gh([
        "pr",
        "view",
        String(plan.pr),
        "--json",
        "headRefOid",
        "--jq",
        ".headRefOid",
        "--repo",
        repoFlag(deps.repo),
      ])
    ).trim();
  } catch (error) {
    return {
      kind: "refuse",
      reasons: [
        `could not decide — the head of PR #${plan.pr} could not be read: ${errorText(error)}`,
      ],
    };
  }
  if (head === "") {
    return {
      kind: "refuse",
      reasons: [
        `could not decide — PR #${plan.pr} reported no head; nothing was verified`,
      ],
    };
  }
  if (head !== plan.head) {
    return {
      kind: "refuse",
      reasons: [
        `head moved — the checks were read on ${plan.head}, PR #${plan.pr} now stands at ${head}: verify that head before merging`,
      ],
    };
  }

  return {
    kind: "merge",
    summary: `${fetched.threads.length} review thread(s), 0 unresolved; head ${head}`,
  };
}
