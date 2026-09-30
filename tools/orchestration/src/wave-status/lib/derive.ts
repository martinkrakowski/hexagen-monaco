import { asHashRecord } from "../../internal/rows.js";
import { governingPlanReview } from "../../internal/review.js";
import type {
  DerivedLane,
  LaneObservation,
  PlanReviewObservation,
  RiskObservation,
  WaveEvent,
} from "../../internal/wave-types.js";

/**
 * Deriving the facts a status page renders from what is on disk: the lane
 * log's own EXIT marker, the gate log's exit and coverage summary, the
 * plan-review gate's verdict and the pre-PR-review gate's.
 *
 * Every function here is pure. It reads an observation and returns derived
 * facts; it never concludes anything the collector has not gathered, and it
 * never defaults a fact it could not read.
 */

export function parseLastExit(tail: string): number | undefined {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^\s*EXIT (\d+)\s*$/.exec(lines[i]);
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function parseGateLog(text: string): {
  readonly exit?: number;
  readonly coverage?: {
    readonly statements: number;
    readonly branches: number;
    readonly functions: number;
    readonly lines: number;
  };
} {
  const lines = text.split("\n");

  let exit: number | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const gateMatch = /^\s*GATE EXIT (\d+)\s*$/.exec(line);
    const exitMatch = /^\s*EXIT (\d+)\s*$/.exec(line);
    if (gateMatch) {
      exit = Number(gateMatch[1]);
    } else if (exitMatch) {
      exit = Number(exitMatch[1]);
    }
    break;
  }

  let statements: number | undefined;
  let branches: number | undefined;
  let functions: number | undefined;
  let lineCount: number | undefined;
  for (const line of lines) {
    const stmt = /^\s*Statements\s*:\s*([\d.]+)%/.exec(line);
    if (stmt) statements = Number(stmt[1]);
    const br = /^\s*Branches\s*:\s*([\d.]+)%/.exec(line);
    if (br) branches = Number(br[1]);
    const fn = /^\s*Functions\s*:\s*([\d.]+)%/.exec(line);
    if (fn) functions = Number(fn[1]);
    const ln = /^\s*Lines\s*:\s*([\d.]+)%/.exec(line);
    if (ln) lineCount = Number(ln[1]);
  }

  const coverage =
    statements !== undefined &&
    branches !== undefined &&
    functions !== undefined &&
    lineCount !== undefined
      ? { statements, branches, functions, lines: lineCount }
      : undefined;

  return {
    ...(exit !== undefined ? { exit } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
  };
}

export function deriveLane(obs: LaneObservation): DerivedLane {
  const exit = obs.log === undefined ? undefined : parseLastExit(obs.log.tail);
  const parsedGate =
    obs.gateLog === undefined ? undefined : parseGateLog(obs.gateLog);
  const gate =
    parsedGate !== undefined &&
    (parsedGate.exit !== undefined || parsedGate.coverage !== undefined)
      ? parsedGate
      : undefined;
  const planReview =
    obs.planReview === undefined ? undefined : planReviewFlag(obs.planReview);
  const risk = riskFlag(obs.risk, obs.pr);

  return {
    ...(exit !== undefined ? { exit } : {}),
    ...(gate !== undefined ? { gate } : {}),
    ...(planReview !== undefined ? { planReview } : {}),
    ...(risk !== undefined ? { risk } : {}),
    alive: obs.alive,
    ...(obs.log !== undefined ? { log: obs.log } : {}),
    ...(obs.pr !== undefined ? { pr: obs.pr } : {}),
    ...(obs.diff !== undefined ? { diff: obs.diff } : {}),
  };
}

/**
 * The plan-review facts the collector gathers for one lane: when it
 * dispatched, the plan file of the review that governed the dispatch, and
 * the row hash that review recorded for the lane. Waves match by the
 * events' own `wave` field — the same identity the merge groups by — never
 * by a directory name stripped of its prefix, which diverges from the
 * events whenever a wave id itself starts with "wave". The governing review
 * is the gate's one rule (`governingPlanReview`): the latest `plan-review
 * settled` event for the dispatch's own wave that precedes the dispatch in
 * LOG ORDER — never a timestamp comparison, which an equal second can hide
 * — and its verdict must be `clear` for the lane to count as reviewed: an
 * earlier clear never survives a later settled review of any verdict.
 */
export function planReviewFacts(
  events: readonly WaveEvent[],
  lane: string,
): PlanReviewObservation {
  let dispatchedAt: string | undefined;
  let dispatchIndex = -1;
  let dispatchWave = "";
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.lane !== lane) continue;
    if (event.stage === "dispatch" && event.event === "started") {
      dispatchedAt = event.ts;
      dispatchIndex = i;
      dispatchWave = event.wave;
      break;
    }
  }
  if (dispatchedAt === undefined) return {};

  const review = governingPlanReview(events, dispatchWave, dispatchIndex);
  if (review === undefined) return { dispatchedAt };
  const reviewedHash =
    review.event.detail?.verdict === "clear"
      ? asHashRecord(review.event.detail?.rows)?.[lane]
      : undefined;
  return {
    dispatchedAt,
    ...(review.plan !== undefined ? { reviewedPlan: review.plan } : {}),
    ...(reviewedHash !== undefined ? { reviewedHash } : {}),
  };
}

/**
 * The plan-review gate's flag, derived and never gathered: a lane dispatched
 * on a row that had no `clear` review before the dispatch — or whose reviewed
 * hash differs from the row's hash at collection time — is "dispatched on an
 * unreviewed row". When the row cannot be re-read at all, the read failed,
 * not the review: that is "nobody looked", which is silence, the same way an
 * events-only row's missing observation is silence — never a verdict invented
 * from a read that failed.
 */
export function planReviewFlag(obs: PlanReviewObservation): string | undefined {
  if (obs.dispatchedAt === undefined) return undefined;
  if (obs.reviewedHash === undefined) return "dispatched on an unreviewed row";
  if (obs.rowHash === undefined) return undefined;
  return obs.rowHash === obs.reviewedHash
    ? undefined
    : "dispatched on an unreviewed row";
}

/**
 * The pre-PR-review gate's flag, derived and never gathered: set only when
 * the lane's row is `high` risk, its PR is currently open, AND the gate
 * would refuse it right now (`risk.refusal` is set — the collector already
 * asked `prePrReviewRefusal` the question, over this wave directory's own
 * events, at collection time). A `normal` row, a closed/merged PR, or a
 * high-risk row whose gate would already pass, are all silence: this flag
 * exists to name exactly one thing — a PR sitting open that the gate would
 * not yet let merge.
 */
export function riskFlag(
  risk: RiskObservation | undefined,
  pr: LaneObservation["pr"],
): string | undefined {
  if (risk === undefined || risk.tier !== "high") return undefined;
  if (pr === undefined || pr.state !== "open") return undefined;
  return risk.refusal === undefined
    ? undefined
    : "high-risk PR open without pre-PR review";
}
