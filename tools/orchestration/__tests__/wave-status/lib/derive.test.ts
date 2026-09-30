import { describe, test, expect } from "vitest";
import {
  deriveLane,
  parseGateLog,
  parseLastExit,
  planReviewFacts,
  planReviewFlag,
  riskFlag,
} from "../../../src/wave-status/lib/derive.js";
import { laneState } from "../../../src/wave-status/lib/lane-state.js";
import type {
  LaneObservation,
  WaveEvent,
} from "../../../src/internal/wave-types.js";

const coverageSummary = (overrides: Record<string, string> = {}): string =>
  [
    "=============================== Coverage summary ===============================",
    `Statements   : ${overrides.statements ?? "100% ( 1000/1000 )"}`,
    `Branches     : ${overrides.branches ?? "100% ( 1000/1000 )"}`,
    `Functions    : ${overrides.functions ?? "100% ( 1000/1000 )"}`,
    `Lines        : ${overrides.lines ?? "100% ( 1000/1000 )"}`,
    "================================================================================",
  ].join("\n");

describe("parseLastExit — the dispatch script's EXIT-marker contract", () => {
  test("an EXIT 1 tail with a body above it reads exit 1", () => {
    expect(
      parseLastExit("building...\nrun failed: ECONNREFUSED\nEXIT 1\n"),
    ).toBe(1);
  });

  test("two markers: the last one wins — a retried lane's earlier failure is history", () => {
    expect(
      parseLastExit(
        "first attempt died\nEXIT 1\nretrying\nfinished clean\nEXIT 0\n",
      ),
    ).toBe(0);
    expect(
      deriveLane({
        alive: false,
        log: {
          bytes: 64,
          mtimeMs: 1,
          tail: "first attempt died\nEXIT 1\nretrying\nfinished clean\nEXIT 0\n",
        },
      }).exit,
    ).toBe(0);
  });

  test("no marker — a lane still working — leaves exit absent", () => {
    expect(parseLastExit("working, no output yet")).toBeUndefined();
  });

  test("a body line that merely mentions EXIT is not a marker", () => {
    expect(parseLastExit("grep EXIT patterns here\nEXIT 0\n")).toBe(0);
    expect(parseLastExit("the marker is EXIT not EXIT-ish\n")).toBeUndefined();
  });

  test("a trailing space on the EXIT marker is still a marker — last one still wins", () => {
    expect(parseLastExit("first attempt died\nEXIT 1\nretrying\nEXIT 0 ")).toBe(
      0,
    );
  });
});

describe("parseGateLog — the gate log's coverage summary and exit", () => {
  test("the four istanbul summary lines produce the four counters", () => {
    const gate = parseGateLog(`${coverageSummary()}\nEXIT 0\n`);
    expect(gate.coverage).toEqual({
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    });
    expect(gate.exit).toBe(0);
  });

  test("an indented istanbul summary still produces the four counters", () => {
    const indented = coverageSummary()
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    const gate = parseGateLog(`${indented}\nEXIT 0\n`);
    expect(gate.coverage).toEqual({
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    });
  });

  test("fractional counters parse as numbers, not strings", () => {
    const gate = parseGateLog(
      `${coverageSummary({ branches: "98.5% ( 985/1000 )", lines: "87.25% ( 1745/2000 )" })}\nEXIT 0\n`,
    );
    expect(gate.coverage).toEqual({
      statements: 100,
      branches: 98.5,
      functions: 100,
      lines: 87.25,
    });
  });

  test("GATE EXIT 0 trailing is accepted as the gate's exit", () => {
    expect(parseGateLog(`${coverageSummary()}\nGATE EXIT 0\n`).exit).toBe(0);
    expect(parseGateLog("...\nGATE EXIT 1\n").exit).toBe(1);
  });

  test("a trailing space on GATE EXIT is still the gate's exit — last marker still wins", () => {
    expect(parseGateLog("GATE EXIT 1\nGATE EXIT 0 ").exit).toBe(0);
  });

  test("a trailing space on the gate log EXIT marker is still the gate's exit", () => {
    expect(parseGateLog(`${coverageSummary()}\nEXIT 0 `).exit).toBe(0);
  });

  test("a non-trailing exit line is not the gate's exit", () => {
    const gate = parseGateLog(`EXIT 0\n${coverageSummary()}\n`);
    expect(gate.exit).toBeUndefined();
    expect(gate.coverage).toBeDefined();
  });

  test("three of four counters is not a summary — coverage stays absent, nothing defaulted", () => {
    const text = coverageSummary()
      .split("\n")
      .filter((line) => !line.startsWith("Functions"))
      .join("\n");
    const gate = parseGateLog(`${text}\nEXIT 0\n`);
    expect(gate.coverage).toBeUndefined();
    expect(gate.exit).toBe(0);
  });

  test("a gate log with no summary and no exit yields an empty fact set", () => {
    expect(parseGateLog("yarn run test:cov\nrunning...\n")).toEqual({});
  });
});

describe("deriveLane — derived facts stay absent when the observation lacks them", () => {
  test("an EXIT 1 log tail with a body above it yields exit 1", () => {
    const derived = deriveLane({
      alive: false,
      log: {
        bytes: 1024,
        mtimeMs: 1_000,
        tail: "agent run\nerror: locked\nEXIT 1\n",
      },
    });
    expect(derived.exit).toBe(1);
    expect(derived.alive).toBe(false);
    expect(derived.log).toEqual({
      bytes: 1024,
      mtimeMs: 1_000,
      tail: "agent run\nerror: locked\nEXIT 1\n",
    });
  });

  test("no log, no gate log: exit and gate stay absent — never defaulted", () => {
    expect(deriveLane({ alive: true })).toEqual({ alive: true });
  });

  test("a log without an EXIT marker leaves exit absent while the log itself is kept", () => {
    const log = { bytes: 0, mtimeMs: 5_000, tail: "" };
    const derived = deriveLane({ alive: true, log });
    expect(derived.exit).toBeUndefined();
    expect(derived.log).toBe(log);
  });

  test("a gate log produces the gate facts; its absence produces no gate object", () => {
    const withGate = deriveLane({
      alive: false,
      gateLog: `${coverageSummary()}\nGATE EXIT 0\n`,
    });
    expect(withGate.gate).toEqual({
      exit: 0,
      coverage: { statements: 100, branches: 100, functions: 100, lines: 100 },
    });
    expect(deriveLane({ alive: false }).gate).toBeUndefined();
    expect(
      deriveLane({ alive: true, gateLog: "yarn run test:cov\nrunning...\n" })
        .gate,
    ).toBeUndefined();
  });

  test("coverage without a trailing gate exit still produces a gate object", () => {
    const derived = deriveLane({ alive: true, gateLog: coverageSummary() });
    expect(derived.gate?.exit).toBeUndefined();
    expect(derived.gate?.coverage).toEqual({
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    });
  });

  test("a trailing GATE EXIT without a coverage summary still produces gate.exit", () => {
    expect(deriveLane({ alive: false, gateLog: "GATE EXIT 1\n" }).gate).toEqual(
      { exit: 1 },
    );
  });

  test("pr and diff observations pass through untouched", () => {
    const pr = {
      number: 218,
      state: "open" as const,
      checks: "pending" as const,
    };
    const diff = { files: 3, insertions: 120, deletions: 14 };
    const derived = deriveLane({ alive: true, pr, diff });
    expect(derived.pr).toEqual(pr);
    expect(derived.diff).toEqual(diff);
  });
});

describe("the plan-review flag", () => {
  const dispatch = (
    lane = "pv-7a",
    ts = "2026-09-28T11:00:00Z",
  ): WaveEvent => ({
    ts,
    wave: "W",
    lane,
    stage: "dispatch",
    event: "started",
  });
  const review = (
    rows: Record<string, string>,
    verdict = "clear",
    ts = "2026-09-28T10:00:00Z",
    wave = "W",
  ): WaveEvent => ({
    ts,
    wave,
    lane: "_plan",
    stage: "plan-review",
    event: "settled",
    detail: { plan: "docs/planning/p.md", rows, verdict },
  });

  test("a lane dispatched on a reviewed, unchanged row carries no flag", () => {
    const derived = deriveLane({
      alive: false,
      planReview: {
        dispatchedAt: "2026-09-28T11:00:00Z",
        reviewedHash: "aa",
        rowHash: "aa",
      },
    });
    expect(derived.planReview).toBeUndefined();
  });

  test("a lane dispatched on a row that changed after the review is flagged", () => {
    const derived = deriveLane({
      alive: false,
      planReview: {
        dispatchedAt: "2026-09-28T11:00:00Z",
        reviewedHash: "aa",
        rowHash: "bb",
      },
    });
    expect(derived.planReview).toBe("dispatched on an unreviewed row");
  });

  test("a lane dispatched with no clear review before it is flagged", () => {
    const derived = deriveLane({
      alive: false,
      planReview: { dispatchedAt: "2026-09-28T11:00:00Z" },
    });
    expect(derived.planReview).toBe("dispatched on an unreviewed row");
  });

  test("a flag is an annotation beside the state, never a lane state", () => {
    const status = {
      wave: "W",
      lane: "pv-7a",
      disagreements: [],
      derived: deriveLane({
        alive: false,
        planReview: { dispatchedAt: "2026-09-28T11:00:00Z" },
      }),
    };
    expect(laneState(status, Date.now())).toBe("vanished");
  });

  test("a lane that never dispatched carries no flag, whatever its facts say", () => {
    expect(
      planReviewFlag({ rowHash: "aa", reviewedHash: "bb" }),
    ).toBeUndefined();
  });

  test("a row that cannot be re-read at collection time is silence, never a verdict", () => {
    const derived = deriveLane({
      alive: false,
      planReview: {
        dispatchedAt: "2026-09-28T11:00:00Z",
        reviewedHash: "aa",
        rowHashMissing: "the plan file could not be read",
      },
    });
    expect(derived.planReview).toBeUndefined();
  });

  test("planReviewFacts reads the dispatch ts and the governing review's hash and plan for the lane", () => {
    const events = [
      dispatch("pv-7b1", "2026-09-28T09:00:00Z"),
      review({ "pv-7b1": "old" }, "clear", "2026-09-28T08:00:00Z"),
      review(
        { "pv-7b1": "stale", "pv-7a": "aa" },
        "clear",
        "2026-09-28T10:00:00Z",
      ),
      dispatch("pv-7a", "2026-09-28T11:00:00Z"),
    ];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
      reviewedPlan: "docs/planning/p.md",
      reviewedHash: "aa",
    });
  });

  test("a review that settled after the dispatch never counts as reviewed", () => {
    const events = [
      dispatch("pv-7a"),
      review({ "pv-7a": "aa" }, "clear", "2026-09-28T12:00:00Z"),
    ];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
    });
  });

  test("a review logged after the dispatch in the SAME second never counts — log order, not timestamps", () => {
    // wave-event.sh records seconds: a review written after a dispatch in
    // that same second carries an equal ts. Order in the log is the only
    // "before" the gate trusts, so the review behind the dispatch governs
    // nothing — the lane stays unreviewed.
    const events = [
      dispatch("pv-7a", "2026-09-28T11:00:00Z"),
      review({ "pv-7a": "aa" }, "clear", "2026-09-28T11:00:00Z"),
    ];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
    });
  });

  test("a review logged before the dispatch in the same second still counts — order decides, not the clock", () => {
    const events = [
      review({ "pv-7a": "aa" }, "clear", "2026-09-28T11:00:00Z"),
      dispatch("pv-7a", "2026-09-28T11:00:00Z"),
    ];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
      reviewedPlan: "docs/planning/p.md",
      reviewedHash: "aa",
    });
  });

  test("a later changes-required review supersedes an earlier clear one", () => {
    // The gate's standing is the latest settled review, whatever its
    // verdict: an older clear never survives it, or the page would bless a
    // dispatch the CLI's own check blocks.
    const events = [
      review({ "pv-7a": "aa" }, "clear", "2026-09-28T09:00:00Z"),
      review({ "pv-7a": "bb" }, "changes-required", "2026-09-28T10:00:00Z"),
      dispatch("pv-7a"),
    ];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
      reviewedPlan: "docs/planning/p.md",
    });
  });

  test("a review whose verdict is not clear never counts as reviewed", () => {
    const events = [
      review({ "pv-7a": "aa" }, "changes-required"),
      dispatch("pv-7a"),
    ];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
      reviewedPlan: "docs/planning/p.md",
    });
  });

  test("a lane absent from the review's rows has no reviewed hash", () => {
    const events = [review({ "pv-7b1": "aa" }), dispatch("pv-7a")];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
      reviewedPlan: "docs/planning/p.md",
    });
  });

  test("another wave's review never covers this wave's dispatch", () => {
    const events = [
      review({ "pv-7a": "aa" }, "clear", "2026-09-28T10:00:00Z", "OTHER"),
      dispatch("pv-7a"),
    ];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
    });
  });

  test("a lane that never dispatched carries no facts at all", () => {
    const events = [review({ "pv-7a": "aa" })];
    expect(planReviewFacts(events, "pv-7a")).toEqual({});
  });

  test("an unparseable ts on either side is irrelevant — the log's order decides", () => {
    // The old rule parsed timestamps and read silence on failure; the rule
    // now consults only the order the lines were written in, so a broken
    // clock neither hides nor invents a review.
    const events = [
      review({ "pv-7a": "aa" }, "clear", "not-a-date"),
      dispatch("pv-7a", "not-a-date-either"),
    ];
    expect(planReviewFacts(events, "pv-7a")).toEqual({
      dispatchedAt: "not-a-date-either",
      reviewedPlan: "docs/planning/p.md",
      reviewedHash: "aa",
    });
  });

  test("a review event with no detail at all covers nothing", () => {
    const bare: WaveEvent = {
      ts: "2026-09-28T10:00:00Z",
      wave: "W",
      lane: "_plan",
      stage: "plan-review",
      event: "settled",
    };
    expect(planReviewFacts([bare, dispatch("pv-7a")], "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
    });
  });

  test("a review event that names no plan carries no plan to hash", () => {
    const noPlan: WaveEvent = {
      ...review({ "pv-7a": "aa" }),
      detail: { rows: { "pv-7a": "aa" }, verdict: "clear" },
    };
    expect(planReviewFacts([noPlan, dispatch("pv-7a")], "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
      reviewedHash: "aa",
    });
    const emptyPlan: WaveEvent = {
      ...review({ "pv-7a": "aa" }),
      detail: { plan: "", rows: { "pv-7a": "aa" }, verdict: "clear" },
    };
    expect(planReviewFacts([emptyPlan, dispatch("pv-7a")], "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
      reviewedHash: "aa",
    });
  });

  test("a _plan event that is not a settled review is skipped", () => {
    const started: WaveEvent = {
      ts: "2026-09-28T10:00:00Z",
      wave: "W",
      lane: "_plan",
      stage: "plan-review",
      event: "started",
    };
    expect(planReviewFacts([started, dispatch("pv-7a")], "pv-7a")).toEqual({
      dispatchedAt: "2026-09-28T11:00:00Z",
    });
  });
});

describe("the risk flag (the pre-PR-review gate)", () => {
  const openPr: LaneObservation["pr"] = {
    number: 42,
    state: "open",
    checks: "pending",
  };
  const mergedPr: LaneObservation["pr"] = {
    number: 42,
    state: "merged",
    checks: "pass",
  };

  test("a normal-risk row never flags, whatever the PR state", () => {
    expect(riskFlag({ tier: "normal" }, openPr)).toBeUndefined();
  });

  test("a high-risk row whose gate would already pass (no refusal) does not flag", () => {
    expect(riskFlag({ tier: "high" }, openPr)).toBeUndefined();
  });

  test("a high-risk row with a refusal, but a CLOSED PR, does not flag — the flag is only for an open PR", () => {
    expect(
      riskFlag(
        { tier: "high", refusal: "no stage=review event=settled" },
        mergedPr,
      ),
    ).toBeUndefined();
  });

  test("a high-risk row with a refusal and no PR at all does not flag", () => {
    expect(
      riskFlag(
        { tier: "high", refusal: "no stage=review event=settled" },
        undefined,
      ),
    ).toBeUndefined();
  });

  test("a high-risk row with a refusal and an OPEN PR flags, in the gate's own words", () => {
    expect(
      riskFlag(
        { tier: "high", refusal: "no stage=review event=settled" },
        openPr,
      ),
    ).toBe("high-risk PR open without pre-PR review");
  });

  test("no risk observation at all (the collector never asked) never flags", () => {
    expect(riskFlag(undefined, openPr)).toBeUndefined();
  });

  test("deriveLane wires obs.risk and obs.pr through to derived.risk", () => {
    const derived = deriveLane({
      alive: false,
      pr: openPr,
      risk: { tier: "high", refusal: "no stage=review event=settled" },
    });
    expect(derived.risk).toBe("high-risk PR open without pre-PR review");
  });

  test("deriveLane carries no risk field when the gate would pass", () => {
    const derived = deriveLane({
      alive: false,
      pr: openPr,
      risk: { tier: "high" },
    });
    expect(derived.risk).toBeUndefined();
  });
});
