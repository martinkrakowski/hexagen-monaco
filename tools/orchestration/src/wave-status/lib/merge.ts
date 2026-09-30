import { deriveLane } from "./derive.js";
import { PLAN_REVIEW_LANE } from "../../internal/rows.js";
import type {
  DerivedLane,
  LaneObservation,
  LaneStatus,
  WaveEvent,
  WaveStatus,
} from "../../internal/wave-types.js";

/**
 * Merge the reported (events) and observed (derived from disk) feeds into one
 * `WaveStatus`.
 *
 * `waveOrder` is the caller's declared order for the wave list — newest first,
 * as the collector reads it from the log tree. When it is given, groups come
 * out in exactly that order and a wave named there with nothing in either feed
 * still gets a group (a wave directory that has written nothing yet is a state
 * worth showing). Waves the order does not mention are appended in first-seen
 * order, so a feed can never lose a row it carries.
 *
 * Without `waveOrder` the list falls back to first-seen order across both
 * feeds. That is the whole reason the parameter exists: an order inferred from
 * which feed a wave happens to appear in puts every evented wave above every
 * observation-only one, which breaks the moment a lane stops emitting.
 */
export function mergeStatus(
  events: readonly WaveEvent[],
  observed: Readonly<Record<string, LaneObservation>>,
  now: string,
  waveOrder?: readonly string[],
  /**
   * Whether the PR listing the observations were joined against was whole.
   * When it is not (a row was skipped), a lane with no PR joined may simply
   * have had its PR in the row nothing could read, so "no PR found" is not
   * something the collector can honestly claim.
   */
  prsComplete = true,
): WaveStatus {
  const groups = new Map<string, { id: string; lanes: string[] }>();
  const latestByKey = new Map<string, WaveEvent>();
  // The seat is a property of the lane, not of its latest event: the dispatch
  // event names who ran it, but a later `settled`/`merge` line does not, and
  // `reported` is only the last one. Keep the most recent seat any event
  // recorded, so a lane that finished still renders the seat that ran it.
  const seatByKey = new Map<string, string>();

  const remember = (wave: string, lane: string): void => {
    // The reserved token reviews the wave; it is never a lane and never a
    // row on the page, whatever feed carries it.
    if (lane === PLAN_REVIEW_LANE) return;
    let group = groups.get(wave);
    if (group === undefined) {
      group = { id: wave, lanes: [] };
      groups.set(wave, group);
    }
    if (!group.lanes.includes(lane)) group.lanes.push(lane);
  };

  for (const event of events) {
    const key = `${event.wave}/${event.lane}`;
    remember(event.wave, event.lane);
    latestByKey.set(key, event);
    const seat = event.detail?.seat;
    if (typeof seat === "string" && seat !== "") seatByKey.set(key, seat);
  }

  for (const key of Object.keys(observed)) {
    const parsed = parseObservedKey(key);
    if (parsed === undefined) continue;
    remember(parsed.wave, parsed.lane);
  }

  const ordered: { id: string; lanes: string[] }[] = [];
  if (waveOrder === undefined) {
    ordered.push(...groups.values());
  } else {
    const emitted = new Set<string>();
    for (const wave of waveOrder) {
      if (emitted.has(wave)) continue;
      emitted.add(wave);
      ordered.push(groups.get(wave) ?? { id: wave, lanes: [] });
    }
    for (const group of groups.values()) {
      if (!emitted.has(group.id)) ordered.push(group);
    }
  }

  return {
    generatedAt: now,
    waves: ordered.map((group) => ({
      id: group.id,
      lanes: group.lanes.map((lane) =>
        buildLane(
          group.id,
          lane,
          latestByKey.get(`${group.id}/${lane}`),
          observed[`${group.id}/${lane}`],
          seatByKey.get(`${group.id}/${lane}`),
          prsComplete,
        ),
      ),
    })),
  };
}

function parseObservedKey(
  key: string,
): { wave: string; lane: string } | undefined {
  const parts = key.split("/");
  if (parts.length !== 2) return undefined;
  const wave = parts[0];
  const lane = parts[1];
  if (!wave || !lane) return undefined;
  return { wave, lane };
}

function buildLane(
  wave: string,
  lane: string,
  latest: WaveEvent | undefined,
  obs: LaneObservation | undefined,
  seat: string | undefined,
  prsComplete: boolean,
): LaneStatus {
  const derived: DerivedLane =
    obs === undefined ? { alive: false } : deriveLane(obs);
  const reported = latest === undefined ? undefined : reportedFrom(latest);
  return {
    wave,
    lane,
    ...(seat !== undefined ? { seat } : {}),
    ...(reported !== undefined ? { reported } : {}),
    derived,
    disagreements: findDisagreements(
      reported,
      derived,
      obs !== undefined,
      prsComplete,
    ),
  };
}

function reportedFrom(event: WaveEvent): NonNullable<LaneStatus["reported"]> {
  return {
    stage: event.stage,
    event: event.event,
    ts: event.ts,
    ...(event.pr !== undefined ? { pr: event.pr } : {}),
    ...(event.round !== undefined ? { round: event.round } : {}),
    ...(event.detail !== undefined ? { detail: event.detail } : {}),
  };
}

/**
 * The contradictions a row can carry, flagged and never resolved. Every
 * message here is a statement of two facts that disagree; none of them picks
 * a winner, because the collector only reads.
 */
function findDisagreements(
  reported: LaneStatus["reported"],
  derived: DerivedLane,
  observed: boolean,
  prsComplete: boolean,
): readonly string[] {
  if (reported === undefined) return [];

  const disagreements: string[] = [];

  // "No PR found" is a gh observation. An events-only row has no observation, so
  // a missing derived.pr there is "nobody looked", not "there is no PR".
  if (
    observed &&
    prsComplete &&
    reported.stage === "implement" &&
    reported.event === "settled" &&
    reported.pr === undefined &&
    !derived.pr
  ) {
    disagreements.push("lane says implement settled; no PR found");
  }

  if (
    reported.stage === "merge" &&
    reported.event === "settled" &&
    derived.pr?.state === "open"
  ) {
    disagreements.push(
      `lane says merge settled; PR #${derived.pr.number} is still open`,
    );
  }

  if (
    reported.stage === "merge" &&
    reported.event === "settled" &&
    derived.pr?.state === "closed"
  ) {
    disagreements.push(
      `lane says merge settled; PR #${derived.pr.number} was closed without merging`,
    );
  }

  if (
    reported.event === "settled" &&
    derived.exit !== undefined &&
    derived.exit !== 0
  ) {
    disagreements.push(
      `lane says ${reported.stage} settled; lane log reports EXIT ${derived.exit}`,
    );
  }

  if (
    reported.stage === "gate" &&
    reported.event === "settled" &&
    derived.gate?.exit !== undefined &&
    derived.gate.exit !== 0
  ) {
    disagreements.push(
      `lane says gate settled; gate log reports GATE EXIT ${derived.gate.exit}`,
    );
  }

  // Hang is a pgrep claim. An events-only row has no observation, so alive:false
  // there is "nobody looked", not "the process is dead".
  if (
    observed &&
    reported.event === "started" &&
    !derived.alive &&
    derived.exit === undefined
  ) {
    disagreements.push(
      `lane says ${reported.stage} started; the process is not alive and the log has no EXIT marker`,
    );
  }

  if (
    reported.stage === "gate" &&
    reported.event === "settled" &&
    derived.gate?.coverage
  ) {
    const cov = derived.gate.coverage;
    const below: string[] = [];
    if (cov.statements < 100) below.push(`statements: ${cov.statements}%`);
    if (cov.branches < 100) below.push(`branches: ${cov.branches}%`);
    if (cov.functions < 100) below.push(`functions: ${cov.functions}%`);
    if (cov.lines < 100) below.push(`lines: ${cov.lines}%`);
    if (below.length > 0) {
      disagreements.push(
        `lane says gate settled; coverage below 100% (${below.join(", ")})`,
      );
    }
  }

  return disagreements;
}
