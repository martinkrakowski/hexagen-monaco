import type { WaveEvent } from "./wave-types.js";
import { PLAN_REVIEW_LANE } from "./rows.js";

/** The review that governs a dispatch, and where it sits in the log. */
export interface GoverningReview {
  readonly event: WaveEvent;
  /** The event's index in the log order the caller handed over. */
  readonly index: number;
  /** The plan file the verdict was taken against, as the reviewer named it. */
  readonly plan?: string;
}

/**
 * The plan-review gate's one rule, run by both of its faces — the CLI's
 * `check` and the status page's collector: the review that governs a
 * dispatch is the LATEST `plan-review settled` event under the reserved
 * `_plan` lane for `wave` that comes before `before` in LOG ORDER — never a
 * timestamp comparison, which an equal second can hide: wave-event.sh
 * records seconds, so a review written after a dispatch in the same second
 * is after it in the log and governs nothing behind it. Whatever verdict
 * that latest review carries is the wave's standing — an earlier `clear`
 * never survives it. The review names the plan its verdict was taken
 * against: `check` confirms that plan is the one on its command line, and
 * the status page hashes that plan — never whichever plan another review in
 * the directory mentioned.
 */
export function governingPlanReview(
  events: readonly WaveEvent[],
  wave: string,
  before?: number,
): GoverningReview | undefined {
  const end = Math.min(before ?? events.length, events.length);
  for (let i = end - 1; i >= 0; i--) {
    const event = events[i];
    if (event.wave !== wave) continue;
    if (event.lane !== PLAN_REVIEW_LANE) continue;
    if (event.stage !== "plan-review" || event.event !== "settled") continue;
    const plan = event.detail?.plan;
    return {
      event,
      index: i,
      ...(typeof plan === "string" && plan !== "" ? { plan } : {}),
    };
  }
  return undefined;
}
