import type { LaneStatus } from "../../internal/wave-types.js";

/**
 * The lane-state ranking: one word per lane, the word being what a reader
 * (and the page's own rollups) can act on.
 *
 * The vocabulary is declared ONCE here. The per-wave header, the page-level
 * summary and the rows themselves are all `laneState` over the same input, so
 * a count can never disagree with the rows beneath it. The page cannot import
 * this module — it is plain HTML — so it carries its own copy, and the page
 * tests drive the same fixture through both.
 */

export type LaneState =
  | "conflict"
  | "failed"
  | "stalled"
  | "running"
  | "vanished"
  | "blocked"
  | "ready"
  | "merged"
  // The ranking's own gap, named: a PR state with no verdict — a closed PR,
  // which the collector can legitimately hand back. A question, never a guess.
  | "unknown";

// The states in the order a reader is shown them — the rollup's own ranking,
// highest-consequence first. Named once here so the per-wave and page-level
// counts, and the `laneStateCounts` zero-initialisation, cannot each invent
// their own list of what a state is: the derivation's output type is the only
// source of its vocabulary.
export const LANE_STATES: readonly LaneState[] = [
  "conflict",
  "failed",
  "stalled",
  "running",
  "vanished",
  "blocked",
  "ready",
  "merged",
  "unknown",
];

// The states that mean "a human is wanted": working now, gone quiet while
// working, contradicting itself, or failed. This is what *hide inactive* keeps —
// everything else (merged, ready, blocked, vanished, unknown) is a lane that is
// not moving and not stuck on a person. The page's inline copy of the rollup
// filter names the same set; a test holds them to the same truth against the
// state fixture, exactly as the parity test does for the derivation itself.
export const NEEDS_HUMAN_STATES: readonly LaneState[] = [
  "conflict",
  "failed",
  "stalled",
  "running",
];

export function isNeedsHumanState(state: LaneState): boolean {
  return NEEDS_HUMAN_STATES.includes(state);
}

export type LaneStateCounts = Record<LaneState, number>;

// Decision: lanes go quiet during a build.
export const stallThresholdMs = 15 * 60 * 1000;

// Decision: a wave whose newest artefact — log write or event — is older than
// this belongs to a past wave, not to a broken current one. A day, not a
// number read off the data: no wave a human is watching goes a day without a
// keystroke, and a session three days old is history whatever state its rows
// happen to land on. The page carries its own copy of this constant (it cannot
// import) and a test pins the two together, exactly as for `stallThresholdMs`.
export const pastWaveThresholdMs = 24 * 60 * 60 * 1000;

/**
 * The newest *dated* fact about a lane — its log's last write, or the event
 * that last spoke about it — or `undefined` when neither carries a date an
 * implementation may stand on. Age is only ever computed from this, so an
 * unparseable ts is silence, never a zero that reads as "seconds ago".
 */
export function laneEvidenceMs(status: LaneStatus): number | undefined {
  const times: number[] = [];
  const logMs = status.derived.log?.mtimeMs;
  if (typeof logMs === "number") times.push(logMs);
  if (status.reported !== undefined) {
    const ts = Date.parse(status.reported.ts);
    if (!Number.isNaN(ts)) times.push(ts);
  }
  return times.length === 0 ? undefined : Math.max(...times);
}

/** Is every dated fact about this lane older than the past-wave threshold? */
export function isPastWaveLane(status: LaneStatus, nowMs: number): boolean {
  const evidence = laneEvidenceMs(status);
  return evidence !== undefined && nowMs - evidence > pastWaveThresholdMs;
}

export function laneState(status: LaneStatus, nowMs: number): LaneState {
  const { derived } = status;
  if (status.disagreements.length > 0) {
    return "conflict";
  }
  if (
    (derived.exit !== undefined && derived.exit !== 0) ||
    (derived.gate?.exit !== undefined && derived.gate.exit !== 0) ||
    derived.pr?.checks === "fail"
  ) {
    return "failed";
  }
  if (
    derived.alive &&
    derived.log !== undefined &&
    derived.log.mtimeMs < nowMs - stallThresholdMs
  ) {
    return "stalled";
  }
  if (derived.alive) {
    return "running";
  }
  if (derived.pr === undefined) {
    // `vanished` must mean something bad — a run that ended, or a
    // terminal claim with no PR to show. A lane whose last words were
    // `started`, with no EXIT in its log and nothing said since, has not been
    // seen vanishing; it has not been seen at all, and that is a missing
    // measurement, which is what `unknown` exists to say. Collapsing this arm
    // back into `vanished` is the mutation this lane's test refuses.
    if (status.reported?.event === "started" && derived.exit === undefined) {
      return "unknown";
    }
    return "vanished";
  }
  // The precedence decision for an open PR, stated once here and mirrored by
  // the page's copy: a *measured* blocker outranks a *missing measurement*,
  // and neither outranks the existing failed arms. An unresolved review thread
  // is a counted fact — something is in the way, which is exactly what
  // `blocked` asserts. `checks: "unknown"` is the opposite assertion — we
  // could not ask — so it never lands on blocked; nor does it land on ready,
  // which is earned only by both measurements answering affirmatively
  // (green checks AND a counted zero threads). A gap on either axis lands on
  // `unknown`.
  if (derived.pr.state === "open") {
    // Absent means no measurement — a payload written before threads were
    // counted — and reads as unknown, never as the silence of a clean row.
    const threads = derived.pr.unresolvedThreads ?? "unknown";
    if (typeof threads === "number" && threads > 0) {
      return "blocked";
    }
    if (derived.pr.checks === "pending" || derived.pr.checks === "none") {
      return "blocked";
    }
    if (derived.pr.checks === "pass" && threads === 0) {
      return "ready";
    }
    return "unknown";
  }
  if (derived.pr.state === "merged") {
    return "merged";
  }
  // The only PR state left is `closed`: the lane's PR was shut without merging,
  // which is not a verdict this ranking owns. Name the gap rather than guess at
  // it — and rather than throw, which is where this function and its copy in
  // the page first parted ways: the page could only render a word, so a throw
  // here was the divergence, not an exemption from it.
  return "unknown";
}

// `alive` and a PR's `checks`/`unresolvedThreads` are each re-read from a live
// probe on every collection — `pgrep` for the first, a `gh api` sweep for the
// second (collect.ts) — so they can be fresher than `laneEvidenceMs`'s dated
// facts (a log's mtime, an event's `ts`) by construction. The past-wave guard
// must yield to any of the three: a process running right now, an open PR
// whose checks are *currently* failing, or an open PR with a *currently*
// counted unresolved thread. Each is a fact this instant, not history, whatever
// the lane's own log last said. `checks: "unknown"` is deliberately excluded —
// the collector earns it separately from `none` to mean "could not ask", and
// treating a failed API read as a verdict would revive every past-wave lane the
// moment one sweep came back empty.
export function hasFreshActionableSignal(status: LaneStatus): boolean {
  if (status.derived.alive) {
    return true;
  }
  const pr = status.derived.pr;
  if (pr === undefined || pr.state !== "open") {
    return false;
  }
  if (pr.checks === "fail") {
    return true;
  }
  return typeof pr.unresolvedThreads === "number" && pr.unresolvedThreads > 0;
}

// A past wave is not a current emergency. `isPastWaveLane` gets its consumer
// here, on the classification only — `laneState` above is untouched, so a lane
// that really contradicted itself still says `conflict` in its row. What
// changes is the promise the header makes: a day-old disagreement no longer
// counts toward "needs a human", though it keeps its own stale-evidence voice
// in the table — UNLESS `hasFreshActionableSignal` says something about it is
// true right now, in which case the guard yields: a lane stuck alive for a day,
// or one whose PR just failed a rebase, or one with a review thread sitting
// open, is exactly what an operator needs to see, and the two fact sets (dated
// evidence vs. live probes) are not the same age.
export function laneNeedsHuman(status: LaneStatus, nowMs: number): boolean {
  if (isPastWaveLane(status, nowMs) && !hasFreshActionableSignal(status)) {
    return false;
  }
  const state = laneState(status, nowMs);
  if (isNeedsHumanState(state)) {
    return true;
  }
  if (state === "blocked") {
    const threads = status.derived.pr?.unresolvedThreads;
    return typeof threads === "number" && threads > 0;
  }
  return false;
}

// The rollup, from the same derivation as the rows: bucket a set of lanes by
// the state `laneState` names for each, over `LANE_STATES` so every state
// carries a number (a known zero, not an absent key). The per-wave header and
// the page summary are both `laneStateCounts` over their lanes, and the page
// renders both from its inline `laneStateOf` — one computation each side, the
// same one the row cells use, so a count can never disagree with the rows
// beneath it. This is the module's half of that seam; the parity test in
// page.test.ts drives the fixture through both.
export function laneStateCounts(
  lanes: readonly LaneStatus[],
  nowMs: number,
): LaneStateCounts {
  const counts = {} as LaneStateCounts;
  for (const state of LANE_STATES) counts[state] = 0;
  for (const lane of lanes) counts[laneState(lane, nowMs)] += 1;
  return counts;
}
