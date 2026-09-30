import { describe, test, expect } from "vitest";
import { mergeStatus } from "../../../src/wave-status/lib/merge.js";
import type {
  LaneObservation,
  WaveEvent,
} from "../../../src/internal/wave-types.js";

const event = (overrides: Partial<WaveEvent> = {}): WaveEvent => ({
  ts: "2026-09-07T16:55:00Z",
  wave: "S",
  lane: "s4",
  stage: "implement",
  event: "started",
  ...overrides,
});

const observation = (
  overrides: Partial<LaneObservation> = {},
): LaneObservation => ({
  alive: true,
  ...overrides,
});

describe("mergeStatus — shape and ordering", () => {
  test("a _plan event is never a lane: it reviews the wave and buys no row", () => {
    const status = mergeStatus(
      [event({ lane: "_plan", stage: "plan-review" })],
      {},
      "now",
    );
    expect(status.waves).toEqual([]);
  });

  test("the latest event for a lane is the reported one; earlier events are history", () => {
    const status = mergeStatus(
      [
        event({ stage: "dispatch", event: "settled" }),
        event({
          stage: "implement",
          event: "started",
          ts: "2026-09-07T16:55:00Z",
        }),
        event({
          stage: "implement",
          event: "settled",
          ts: "2026-09-07T17:20:00Z",
          pr: 218,
          round: 1,
          detail: { fixed: 5, refuted: 2 },
        }),
      ],
      {},
      "2026-09-07T17:25:00Z",
    );
    expect(status.generatedAt).toBe("2026-09-07T17:25:00Z");
    const lane = status.waves[0]?.lanes[0];
    expect(lane?.reported).toEqual({
      stage: "implement",
      event: "settled",
      ts: "2026-09-07T17:20:00Z",
      pr: 218,
      round: 1,
      detail: { fixed: 5, refuted: 2 },
    });
    expect(lane?.derived).toEqual({ alive: false });
    expect(lane?.disagreements).toEqual([]);
  });

  test("waves and lanes appear in first-seen order and never reshuffle", () => {
    const status = mergeStatus(
      [
        event({ wave: "S", lane: "s4" }),
        event({ wave: "A", lane: "g1" }),
        event({ wave: "S", lane: "s3" }),
        event({ wave: "2", lane: "w2a" }),
      ],
      {},
      "now",
    );
    expect(status.waves.map((wave) => wave.id)).toEqual(["S", "A", "2"]);
    expect(status.waves[0]?.lanes.map((lane) => lane.lane)).toEqual([
      "s4",
      "s3",
    ]);
  });

  test("a lane with events but no observation renders as a row", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "started" })],
      {},
      "now",
    );
    const lane = status.waves[0]?.lanes[0];
    expect(lane).toMatchObject({ wave: "S", lane: "s4" });
    expect(lane?.reported).toMatchObject({ stage: "gate" });
    expect(lane?.derived).toEqual({ alive: false });
  });

  test("a lane with an observation but no events renders as a row with only derived facts", () => {
    const status = mergeStatus(
      [],
      {
        "S/s4": observation({
          alive: false,
          log: { bytes: 0, mtimeMs: 1, tail: "" },
        }),
      },
      "now",
    );
    const lane = status.waves[0]?.lanes[0];
    expect(lane?.reported).toBeUndefined();
    expect(lane?.derived).toEqual({
      alive: false,
      log: { bytes: 0, mtimeMs: 1, tail: "" },
    });
    expect(lane?.disagreements).toEqual([]);
  });

  test("an observed lane joins the wave and lane order after the evented ones", () => {
    const status = mergeStatus(
      [event({ wave: "S", lane: "s4" })],
      { "S/s3": observation(), "A/g1": observation() },
      "now",
    );
    expect(status.waves.map((wave) => wave.id)).toEqual(["S", "A"]);
    expect(status.waves[0]?.lanes.map((lane) => lane.lane)).toEqual([
      "s4",
      "s3",
    ]);
  });

  test("a lane with no events and no observation contributes no row", () => {
    const status = mergeStatus([event()], { "S/s3": observation() }, "now");
    expect(status.waves).toHaveLength(1);
    expect(status.waves[0]?.lanes.map((lane) => lane.lane)).toEqual([
      "s4",
      "s3",
    ]);
  });

  test("a declared wave order decides the list, not which feed a wave appears in", () => {
    // Wave 9 is the live one and emits nothing; wave 8 reported and is older.
    // Feed order puts 8 first — that is the defect this parameter exists for.
    const status = mergeStatus(
      [event({ wave: "8", lane: "a" })],
      { "9/b": observation() },
      "now",
      ["9", "8"],
    );
    expect(status.waves.map((wave) => wave.id)).toEqual(["9", "8"]);
    // Each wave keeps its own rows: the order changes nothing about content.
    expect(status.waves[0]?.lanes.map((lane) => lane.lane)).toEqual(["b"]);
    expect(status.waves[0]?.lanes[0]?.reported).toBeUndefined();
    expect(status.waves[1]?.lanes[0]?.reported).toMatchObject({
      stage: "implement",
    });
  });

  test("a wave in the declared order with nothing in either feed is an empty wave, not an absent one", () => {
    const status = mergeStatus([], {}, "now", ["11"]);
    expect(status.waves.map((wave) => wave.id)).toEqual(["11"]);
    expect(status.waves[0]?.lanes).toEqual([]);
  });

  test("a wave the order does not mention still appears, after every wave it does", () => {
    // The order is a collector's view of the tree; a feed naming a wave it
    // never listed (an event whose body disagrees with its directory) must
    // still show its rows rather than be dropped to keep the list tidy.
    const status = mergeStatus(
      [event({ wave: "ghost", lane: "g1" })],
      { "9/b": observation() },
      "now",
      ["9"],
    );
    expect(status.waves.map((wave) => wave.id)).toEqual(["9", "ghost"]);
  });

  test("a wave named twice in the declared order is emitted once", () => {
    const status = mergeStatus([], { "9/b": observation() }, "now", ["9", "9"]);
    expect(status.waves.map((wave) => wave.id)).toEqual(["9"]);
  });

  test("malformed observation keys are not lanes", () => {
    const status = mergeStatus(
      [],
      {
        bad: observation(),
        "S/s4/extra": observation(),
        "/s4": observation(),
        "S/": observation(),
        "S/s4": observation(),
      },
      "now",
    );
    expect(status.waves.map((wave) => wave.id)).toEqual(["S"]);
    expect(status.waves[0]?.lanes.map((lane) => lane.lane)).toEqual(["s4"]);
  });
});

describe("mergeStatus — the seat that ran a lane", () => {
  test("a seat recorded on an earlier event survives later events that do not carry it", () => {
    const status = mergeStatus(
      [
        event({
          stage: "dispatch",
          event: "started",
          detail: { seat: "anvil-orbit-4.2-flash-max" },
        }),
        event({
          stage: "implement",
          event: "settled",
          ts: "2026-09-07T17:20:00Z",
          pr: 218,
        }),
        event({
          stage: "merge",
          event: "settled",
          ts: "2026-09-07T18:00:00Z",
          pr: 218,
        }),
      ],
      {},
      "now",
    );
    const lane = status.waves[0]?.lanes[0];
    // The latest event is still the reported one; the seat is lane-level.
    expect(lane?.reported?.stage).toBe("merge");
    expect(lane?.seat).toBe("anvil-orbit-4.2-flash-max");
  });

  test("the most recent recorded seat wins when a lane is redispatched", () => {
    const status = mergeStatus(
      [
        event({
          stage: "dispatch",
          event: "started",
          detail: { seat: "kiln/dark-fennel" },
        }),
        event({
          stage: "implement",
          event: "failed",
          detail: { seat: "kiln-go/quartz-2.7-lite" },
        }),
      ],
      {},
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.seat).toBe("kiln-go/quartz-2.7-lite");
  });

  test("no event ever names a seat — the lane has none, it is not defaulted", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "settled" })],
      {},
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.seat).toBeUndefined();
    expect(status.waves[0]?.lanes[0]).not.toHaveProperty("seat");
  });

  test("a non-string or empty detail.seat is not a seat — never coerced or guessed", () => {
    const status = mergeStatus(
      [
        event({ lane: "s1", detail: { seat: 7 } }),
        event({ lane: "s2", detail: { seat: "" } }),
        event({ lane: "s3", detail: { seat: { model: "x" } } }),
      ],
      {},
      "now",
    );
    const seats = status.waves[0]?.lanes.map((lane) => lane.seat);
    expect(seats).toEqual([undefined, undefined, undefined]);
  });
});

describe("mergeStatus — disagreements are flagged, never resolved", () => {
  test("reported implement settled with no PR found", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "settled" })],
      { "S/s4": observation() },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says implement settled; no PR found",
    ]);
  });

  test("sibling: with an incomplete PR listing the lane is not flagged for a missing PR", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "settled" })],
      { "S/s4": observation() },
      "now",
      undefined,
      false,
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("sibling: an unobserved lane (events only) is never told no PR found — nobody looked", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "settled" })],
      {},
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("sibling: implement settled with a PR observed agrees — no disagreement", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "settled", pr: 218 })],
      {
        "S/s4": observation({
          pr: { number: 218, state: "open", checks: "pending" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("sibling: implement settled, a PR on the observation fills a missing event number", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "settled" })],
      {
        "S/s4": observation({
          pr: { number: 218, state: "open", checks: "pending" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("reported merge settled with the PR still open", () => {
    const status = mergeStatus(
      [event({ stage: "merge", event: "settled" })],
      {
        "S/s4": observation({
          pr: { number: 218, state: "open", checks: "pass" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says merge settled; PR #218 is still open",
    ]);
  });

  test("reported merge settled with the PR closed without merging", () => {
    const status = mergeStatus(
      [event({ stage: "merge", event: "settled" })],
      {
        "S/s4": observation({
          pr: { number: 218, state: "closed", checks: "fail" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says merge settled; PR #218 was closed without merging",
    ]);
  });

  test("sibling: merge settled with the PR merged agrees", () => {
    const status = mergeStatus(
      [event({ stage: "merge", event: "settled" })],
      {
        "S/s4": observation({
          pr: { number: 218, state: "merged", checks: "pass" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("reported settled with a non-zero EXIT in the log tail", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "settled" })],
      {
        "S/s4": observation({
          alive: false,
          log: { bytes: 10, mtimeMs: 1, tail: "gate failed\nEXIT 1\n" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says gate settled; lane log reports EXIT 1",
    ]);
  });

  test("sibling: reported settled with EXIT 0 agrees", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "settled" })],
      {
        "S/s4": observation({
          alive: false,
          log: { bytes: 10, mtimeMs: 1, tail: "done\nEXIT 0\n" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("reported gate settled with a non-zero GATE EXIT in the gate log", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "settled" })],
      { "S/s4": observation({ gateLog: "yarn run test:cov\nGATE EXIT 1\n" }) },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says gate settled; gate log reports GATE EXIT 1",
    ]);
  });

  test("sibling: reported gate settled with GATE EXIT 0 agrees", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "settled" })],
      { "S/s4": observation({ gateLog: "yarn run test:cov\nGATE EXIT 0\n" }) },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("reported implement started, process dead, no EXIT marker — a hang, not progress", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "started" })],
      {
        "S/s4": observation({
          alive: false,
          log: { bytes: 5, mtimeMs: 1, tail: "buffered output only" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says implement started; the process is not alive and the log has no EXIT marker",
    ]);
  });

  test("reported dispatch started, process dead, no EXIT marker — flags disagreement", () => {
    const status = mergeStatus(
      [event({ stage: "dispatch", event: "started" })],
      {
        "S/s4": observation({
          alive: false,
          log: { bytes: 5, mtimeMs: 1, tail: "buffered output only" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says dispatch started; the process is not alive and the log has no EXIT marker",
    ]);
  });

  test("sibling: implement started with the process alive agrees", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "started" })],
      { "S/s4": observation({ alive: true }) },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("sibling: implement started, process dead, but an EXIT marker means it finished — not a hang", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "started" })],
      {
        "S/s4": observation({
          alive: false,
          log: { bytes: 10, mtimeMs: 1, tail: "done\nEXIT 0\n" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("an unobserved lane (events only) is never accused of hanging — there is no pgrep evidence", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "started" })],
      {},
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("reported gate settled with coverage below 100 on any counter", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "settled" })],
      {
        "S/s4": observation({
          gateLog:
            "Statements   : 100% ( 1000/1000 )\nBranches     : 98.5% ( 985/1000 )\nFunctions    : 100% ( 1000/1000 )\nLines        : 99.9% ( 999/1000 )\nEXIT 0\n",
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says gate settled; coverage below 100% (branches: 98.5%, lines: 99.9%)",
    ]);
  });

  test("sibling: reported gate settled with full coverage agrees", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "settled" })],
      {
        "S/s4": observation({
          gateLog:
            "Statements   : 100% ( 1000/1000 )\nBranches     : 100% ( 1000/1000 )\nFunctions    : 100% ( 1000/1000 )\nLines        : 100% ( 1000/1000 )\nEXIT 0\n",
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("gate settled without a gate log has nothing to disagree with on coverage", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "settled" })],
      {},
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([]);
  });

  test("every coverage counter below 100 is listed", () => {
    const status = mergeStatus(
      [event({ stage: "gate", event: "settled" })],
      {
        "S/s4": observation({
          gateLog:
            "Statements   : 99% ( 990/1000 )\nBranches     : 98% ( 980/1000 )\nFunctions    : 97% ( 970/1000 )\nLines        : 96% ( 960/1000 )\nEXIT 0\n",
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says gate settled; coverage below 100% (statements: 99%, branches: 98%, functions: 97%, lines: 96%)",
    ]);
  });

  test("several contradictions accumulate on one lane", () => {
    const status = mergeStatus(
      [event({ stage: "implement", event: "settled", round: 2 })],
      {
        "S/s4": observation({
          alive: false,
          log: { bytes: 10, mtimeMs: 1, tail: "died\nEXIT 1\n" },
        }),
      },
      "now",
    );
    expect(status.waves[0]?.lanes[0]?.disagreements).toEqual([
      "lane says implement settled; no PR found",
      "lane says implement settled; lane log reports EXIT 1",
    ]);
  });
});
