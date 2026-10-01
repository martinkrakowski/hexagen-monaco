import type { WaveEvent } from "./wave-types.js";

/** The latest `<stage> settled` event for (wave, lane), in log order, or undefined. */
export function latestStageSettled(
  events: readonly WaveEvent[],
  wave: string,
  lane: string,
  stage: WaveEvent["stage"],
): { readonly event: WaveEvent; readonly index: number } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.wave !== wave) continue;
    if (event.lane !== lane) continue;
    if (event.stage !== stage || event.event !== "settled") continue;
    return { event, index: i };
  }
  return undefined;
}

/** Is there a `remediate settled` for (wave, lane) strictly after `afterIndex`, in log order? */
function hasLaterRemediateSettled(
  events: readonly WaveEvent[],
  wave: string,
  lane: string,
  afterIndex: number,
): boolean {
  for (let i = afterIndex + 1; i < events.length; i++) {
    const event = events[i];
    if (
      event.wave === wave &&
      event.lane === lane &&
      event.stage === "remediate" &&
      event.event === "settled"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The pre-PR-review gate for a `high`-risk lane: `undefined` when a merge
 * may proceed, or the reason it may not — naming the missing event — when it
 * may not.
 *
 * The wave log must hold `stage=review event=settled` for this lane, AND its
 * verdict must be `clear` — or `changes-required` with a LATER
 * `stage=remediate event=settled` for the same lane, in log order. Every
 * other verdict refuses, BY NAME: a missing `detail.verdict` (the ordinary
 * post-PR review bots emit `stage=review event=settled` with only finding
 * counts — `{"bug":1,"suggestion":2,"nit":0}` — and no verdict at all) or any
 * string this gate does not recognise. The gate fails CLOSED: only a verdict
 * it can read as clearance ever passes it, never "anything but the one
 * verdict this function happens to check for."
 *
 * "Latest" and "later" are both LOG ORDER, never a timestamp comparison —
 * the same reason `governingPlanReview` gives: wave-event.sh records whole
 * seconds, so two events in the same second are still ordered by the log.
 */
export function prePrReviewRefusal(
  events: readonly WaveEvent[],
  wave: string,
  lane: string,
): string | undefined {
  const review = latestStageSettled(events, wave, lane, "review");
  if (review === undefined) {
    return `no stage=review event=settled for lane ${lane} in wave ${wave}`;
  }
  const verdict = review.event.detail?.verdict;
  if (verdict === "clear") {
    return undefined;
  }
  if (verdict === "changes-required") {
    if (hasLaterRemediateSettled(events, wave, lane, review.index)) {
      return undefined;
    }
    return (
      `stage=review event=settled for lane ${lane} in wave ${wave} ended changes-required ` +
      `with no later stage=remediate event=settled`
    );
  }
  if (verdict === undefined) {
    return `stage=review event=settled for lane ${lane} in wave ${wave} carries no verdict recorded`;
  }
  return (
    `stage=review event=settled for lane ${lane} in wave ${wave} carries an unrecognised verdict ` +
    `${JSON.stringify(verdict)}`
  );
}
