export type Stage =
  | "plan-review"
  | "dispatch"
  | "implement"
  | "gate"
  | "review"
  | "remediate"
  | "sweep"
  | "merge"
  | "record";

export type EventKind = "started" | "settled" | "failed";

export interface WaveEvent {
  readonly ts: string;
  readonly wave: string;
  readonly lane: string;
  readonly stage: Stage;
  readonly event: EventKind;
  readonly pr?: number;
  readonly round?: number;
  readonly detail?: {
    readonly fixed?: number;
    readonly refuted?: number;
    readonly mutations?: number;
    readonly mutationsBit?: number;
    readonly [k: string]: unknown;
  };
}

/**
 * The checks conclusion for a PR head. Since S3, `none` means exactly one
 * thing: the read was taken and no `Build*` check has run. `unknown` is
 * *could not ask* — a failed call, a response nothing could parse, or a head
 * the sweep deliberately did not query (merged, closed, unclaimed). A default
 * must never wear the mask of a measurement: those were four meanings in one
 * value before, and a failed read rendered identically to a PR with no CI.
 */
export type PrChecks = "none" | "pending" | "pass" | "fail" | "unknown";

/**
 * The unresolved-review-thread signal: a count (counts and states, never
 * prose), or `unknown` when the one thread query could not be taken or could
 * not be read for this PR.
 */
export type PrThreadSignal = number | "unknown";

/**
 * The plan-review gate's facts about one lane, gathered by the collector: the
 * when of its dispatch, the row hash the wave's clear review recorded, and the
 * row's hash at collection time. The flag itself is derived (derive.ts), never
 * gathered — the collector only reads, it does not conclude.
 */
export interface PlanReviewObservation {
  /** The ts of the lane's `dispatch started` event, when there was one. */
  readonly dispatchedAt?: string;
  /**
   * The plan file the review that governed the dispatch named — the one
   * `rowHash` is taken against, never whichever plan another review in the
   * directory mentioned.
   */
  readonly reviewedPlan?: string;
  /** The lane's row hash from the governing review, when its verdict was clear. */
  readonly reviewedHash?: string;
  /** The lane row's hash, taken from the plan at collection time. */
  readonly rowHash?: string;
  /** Why `rowHash` is absent — the plan could not be read, or holds no unambiguous row for the lane. */
  readonly rowHashMissing?: string;
}

/**
 * D184's pre-PR-review gate facts about one lane, gathered by the collector:
 * its risk tier (discovered by grepping `docs/planning/`, exactly as
 * `pre-pr-check` does), and, for a `high` tier only, why the gate would
 * refuse a merge right now — `undefined` there means the gate would pass.
 * The flag itself ("high-risk PR open without pre-PR review") is derived
 * (derive.ts) from this plus the lane's PR state, never gathered here.
 */
export interface RiskObservation {
  readonly tier: "high" | "normal";
  readonly refusal?: string;
}

export interface LaneObservation {
  readonly log?: {
    readonly bytes: number;
    readonly mtimeMs: number;
    readonly tail: string;
  };
  readonly gateLog?: string;
  readonly planReview?: PlanReviewObservation;
  readonly risk?: RiskObservation;
  readonly alive: boolean;
  readonly pr?: {
    readonly number: number;
    readonly state: "open" | "merged" | "closed";
    readonly checks: PrChecks;
    /**
     * Unresolved review threads, from the single read-only thread query the
     * sweep runs for every open PR. `prFacts` sets this on every open fact —
     * a number, or "unknown". Absent means the PR is not open (threads were
     * never its question) or the payload predates S3; consumers must read an
     * open PR's absence as "unknown", never as a silent zero.
     */
    readonly unresolvedThreads?: PrThreadSignal;
  };
  readonly diff?: {
    readonly files: number;
    readonly insertions: number;
    readonly deletions: number;
  };
}

export interface DerivedLane {
  readonly exit?: number;
  readonly gate?: {
    readonly exit?: number;
    readonly coverage?: {
      statements: number;
      branches: number;
      functions: number;
      lines: number;
    };
  };
  readonly alive: boolean;
  readonly log?: LaneObservation["log"];
  readonly pr?: LaneObservation["pr"];
  readonly diff?: LaneObservation["diff"];
  /**
   * The plan-review gate's flag, verbatim: "dispatched on an unreviewed row".
   * A derived annotation, not a lane state — the page's inline state copy is
   * held to the module's by parity tests that cannot see this field, so the
   * flag rides beside the state, never inside it.
   */
  readonly planReview?: string;
  /**
   * D184's pre-PR-review gate flag, verbatim: "high-risk PR open without
   * pre-PR review" — set only for a `high`-risk lane whose PR is open and
   * whose wave log does not yet hold a settled pre-PR review (or holds a
   * `changes-required` one with no later remediation). Derived, exactly like
   * `planReview` above, and for the same reason: it rides beside the state,
   * never inside it.
   */
  readonly risk?: string;
}

export interface LaneStatus {
  readonly wave: string;
  readonly lane: string;
  /**
   * The seat that ran this lane, taken from any event that recorded one. A
   * lane attribute, not a property of its latest event: `reported` is only the
   * last line, and a lane's `implement settled`/`merge settled` do not carry
   * the seat, so reading it off `reported.detail` loses it for every lane that
   * finished. Absent means no event ever named one — never guessed.
   */
  readonly seat?: string;
  readonly reported?: {
    readonly stage: Stage;
    readonly event: EventKind;
    readonly ts: string;
    readonly pr?: number;
    readonly round?: number;
    readonly detail?: WaveEvent["detail"];
  };
  readonly derived: DerivedLane;
  readonly disagreements: readonly string[];
}

/**
 * The PR corpus, when the read was not whole. `skipped` counts the rows `gh`
 * returned that no parser could read, so a lane with no PR is a lane whose PR
 * may be one of them — not a lane without one. Absent means the corpus was
 * read whole: a repository with no pull requests is an empty corpus, and that
 * is an answer. A read that failed outright never becomes a status at all —
 * it is a rejected collection.
 */
export interface PrCorpusGap {
  readonly skipped: number;
}

import type { BacklogState } from "./backlog.js";

export interface WaveStatus {
  readonly generatedAt: string;
  readonly prs?: PrCorpusGap;
  readonly waves: readonly {
    readonly id: string;
    readonly lanes: readonly LaneStatus[];
  }[];
  readonly backlog?: BacklogState;
}
