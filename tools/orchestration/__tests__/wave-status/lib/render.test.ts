/* eslint-disable no-control-regex -- this file asserts that control bytes from disk never reach the terminal, so it must name them. */
import { describe, expect, test, vi } from "vitest";
import { renderStatus, truncate } from "../../../src/wave-status/lib/render.js";
import { laneState } from "../../../src/wave-status/lib/lane-state.js";
import type {
  LaneStatus,
  WaveStatus,
} from "../../../src/internal/wave-types.js";

const TS = "2026-09-07T17:00:00Z";

function makeLane(
  lane: string,
  overrides: {
    wave?: string;
    seat?: string;
    reported?: LaneStatus["reported"];
    alive?: boolean;
    pr?: LaneStatus["derived"]["pr"];
    gate?: LaneStatus["derived"]["gate"];
  } = {},
): LaneStatus {
  return {
    wave: overrides.wave ?? "T",
    lane,
    ...(overrides.seat === undefined ? {} : { seat: overrides.seat }),
    ...(overrides.reported === undefined
      ? {}
      : { reported: overrides.reported }),
    derived: {
      alive: overrides.alive ?? false,
      ...(overrides.pr === undefined ? {} : { pr: overrides.pr }),
      ...(overrides.gate === undefined ? {} : { gate: overrides.gate }),
    },
    disagreements: [],
  };
}

function makeStatus(lanes: readonly LaneStatus[], id = "T"): WaveStatus {
  return { generatedAt: "2026-09-09T00:00:00Z", waves: [{ id, lanes }] };
}

/** Visible length: ANSI SGR sequences occupy columns only in the mind of the painter. */
function visibleLength(line: string): number {
  // eslint-disable-next-line no-control-regex -- measuring the visible width of a painted line.
  return line.replace(/\x1b\[[0-9;]*m/g, "").length;
}

describe("renderStatus", () => {
  /* eslint-disable turbo/no-undeclared-env-vars -- COLUMNS is the operator's own terminal, set here to prove the renderer ignores it; it is not a turbo pipeline input. */
  test("is pure: the same input renders the same string, whatever the environment says", () => {
    const status = makeStatus([
      makeLane("t1", {
        reported: { stage: "review", event: "started", ts: TS, round: 2 },
        pr: { number: 12, state: "open", checks: "pending" },
        gate: {
          exit: 0,
          coverage: {
            statements: 100,
            branches: 90,
            functions: 95,
            lines: 100,
          },
        },
        alive: true,
      }),
    ]);
    process.env.COLUMNS = "20";
    let first: string;
    try {
      first = renderStatus(status);
    } finally {
      delete process.env.COLUMNS;
    }
    expect(renderStatus(status)).toBe(first);
  });

  test("a lane with no PR renders —; one with a PR renders its number", () => {
    const out = renderStatus(
      makeStatus([
        makeLane("t1", {
          pr: { number: 12, state: "open", checks: "pass" },
          alive: true,
        }),
        makeLane("t2"),
      ]),
    );
    const rows = out.split("\n");
    const withPr = rows.find((line) => line.includes("T/t1"));
    const withoutPr = rows.find((line) => line.includes("T/t2"));
    expect(withPr).toContain("#12 open pass");
    expect(withoutPr).toMatch(
      /T\/t2\s+unknown\s+—\s+not alive\s+—\s+—\s+—\s+—$/,
    );
  });

  test("the seat column sits between lane and stage, and renders the seat or the honest unknown", () => {
    const out = renderStatus(
      makeStatus([
        makeLane("t1", { seat: "kiln-go/quartz-2.7-lite", alive: true }),
        makeLane("t2", { alive: true }),
      ]),
      { color: false },
    );
    const lines = out.split("\n");
    const header = lines.find(
      (line) => line.includes("lane") && line.includes("seat"),
    );
    expect(header).toBeDefined();
    expect(header!.indexOf("lane")).toBeLessThan(header!.indexOf("seat"));
    expect(header!.indexOf("seat")).toBeLessThan(header!.indexOf("stage"));

    const named = lines.find((line) => line.includes("T/t1"));
    const absent = lines.find((line) => line.includes("T/t2"));
    expect(named).toContain("kiln-go/quartz-2.7-lite");
    // A lane no event ever named a seat for says unknown — never blank, never guessed.
    expect(absent).toMatch(/T\/t2\s+unknown\s+—/);
  });

  test("a seat carrying a bare escape character is stripped, not painted", () => {
    const out = renderStatus(
      makeStatus([makeLane("t1", { seat: "anvil\x1b[2Jquartz", alive: true })]),
      {
        color: false,
      },
    );
    const row = out.split("\n").find((line) => line.includes("T/t1"));
    expect(row).toContain("anvil[2Jquartz");
    expect(row).not.toContain("\x1b");
  });

  test("{ color: false } output contains no ANSI escape — and so does the default", () => {
    const status = makeStatus([
      makeLane("t1", {
        reported: { stage: "gate", event: "failed", ts: TS },
        pr: { number: 7, state: "closed", checks: "fail" },
        gate: { exit: 3 },
        alive: true,
      }),
    ]);
    expect(renderStatus(status, { color: false })).not.toMatch(/\x1b/);
    expect(renderStatus(status)).not.toMatch(/\x1b/);
  });

  test("a narrow width truncates rather than wrapping — no line exceeds it", () => {
    const status = makeStatus([
      makeLane("w1a-implement-past-the-default-width", {
        reported: { stage: "review", event: "settled", ts: TS, round: 1 },
        pr: { number: 1234, state: "open", checks: "pending" },
        gate: {
          exit: 1,
          coverage: {
            statements: 100,
            branches: 90,
            functions: 95,
            lines: 100,
          },
        },
        alive: true,
      }),
    ]);
    const full = renderStatus(status);
    expect(full.split("\n").some((line) => line.length > 30)).toBe(true);
    for (const width of [30, 80]) {
      for (const line of renderStatus(status, { width }).split("\n")) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
    // The default is the contract's 100 — and it cuts, it does not wrap.
    for (const line of full.split("\n"))
      expect(line.length).toBeLessThanOrEqual(100);
    expect(full.split("\n").some((line) => line.length === 100)).toBe(true);
  });

  test("a wave with no lanes renders its heading and no rows, without throwing", () => {
    expect(renderStatus(makeStatus([], "T"))).toBe("wave T");
  });

  test("a corpus that was not read whole says so, rather than letting every PR column read as absence", () => {
    // A bare em dash is read as "no PR". Rows that could not be parsed are a
    // gap in the read, and the terminal face owes the same honesty the page does.
    const gapped: WaveStatus = {
      ...makeStatus([makeLane("t2")]),
      prs: { skipped: 2 },
    };
    const out = renderStatus(gapped);
    expect(out.split("\n")).toContain(
      "prs: 2 row(s) could not be read — a lane with no PR may be one of them",
    );
    expect(renderStatus(makeStatus([makeLane("t2")]))).not.toContain(
      "could not be read",
    );
  });

  test("a gap with no waves at all renders the gap alone, with no leading blank", () => {
    const out = renderStatus({
      generatedAt: "now",
      prs: { skipped: 1 },
      waves: [],
    });
    expect(out).toBe(
      "prs: 1 row(s) could not be read — a lane with no PR may be one of them",
    );
  });

  test("the gap line is cut to the width like every other line", () => {
    const gapped: WaveStatus = {
      ...makeStatus([makeLane("t2")]),
      prs: { skipped: 2 },
    };
    for (const line of renderStatus(gapped, { width: 20 }).split("\n")) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  test("a status with no waves renders nothing", () => {
    expect(
      renderStatus({ generatedAt: "2026-09-09T00:00:00Z", waves: [] }),
    ).toBe("");
  });

  test("each wave renders its own block, separated by a blank line", () => {
    const out = renderStatus({
      generatedAt: "2026-09-09T00:00:00Z",
      waves: [
        { id: "T", lanes: [makeLane("t1", { alive: true })] },
        { id: "U", lanes: [makeLane("u1", { wave: "U" })] },
      ],
    });
    expect(out.split("\n")).toEqual([
      "wave T",
      expect.stringContaining("lane"),
      expect.stringContaining("T/t1"),
      "",
      "wave U",
      expect.stringContaining("lane"),
      expect.stringContaining("U/u1"),
    ]);
  });

  test("a reported round renders with the stage; its absence renders without one", () => {
    const out = renderStatus(
      makeStatus([
        makeLane("t1", {
          reported: { stage: "gate", event: "started", ts: TS, round: 0 },
          alive: true,
        }),
        makeLane("t2", {
          reported: { stage: "gate", event: "started", ts: TS },
          alive: true,
        }),
      ]),
    );
    expect(out).toContain("gate started (round 0)");
    expect(out).toMatch(/gate started {2,}/);
  });

  test("the gate column renders exit and coverage, or — when either is missing", () => {
    const out = renderStatus(
      makeStatus([
        makeLane("t1", {
          gate: {
            exit: 0,
            coverage: {
              statements: 98,
              branches: 95,
              functions: 97,
              lines: 98,
            },
          },
        }),
        makeLane("t2", { gate: { exit: 3 } }),
        makeLane("t3", { gate: {} }),
        makeLane("t4", {
          gate: {
            coverage: {
              statements: 50,
              branches: 60,
              functions: 70,
              lines: 80,
            },
          },
        }),
      ]),
    );
    expect(out).toContain("exit 0 · 98/95/97/98%");
    expect(out).toContain("exit 3");
    expect(out).toContain("· 50/60/70/80%");
    expect(out).toMatch(/T\/t3\s+unknown\s+—\s+not alive\s+—\s+—\s+—\s+—$/m);
  });

  test("colour is opt-in and paints the page's tones", () => {
    const status = makeStatus([
      makeLane("t1", { reported: { stage: "gate", event: "failed", ts: TS } }),
      makeLane("t2", {
        reported: { stage: "review", event: "settled", ts: TS },
        alive: true,
        pr: { number: 13, state: "merged", checks: "none" },
      }),
      makeLane("t3", {
        reported: { stage: "dispatch", event: "started", ts: TS },
        alive: true,
        pr: { number: 14, state: "open", checks: "pass" },
      }),
      makeLane("t4", {
        alive: true,
        pr: { number: 15, state: "closed", checks: "fail" },
        gate: { exit: 2 },
      }),
      makeLane("t5", {
        alive: true,
        pr: { number: 16, state: "open", checks: "pending" },
        gate: {
          exit: 0,
          coverage: { statements: 98, branches: 95, functions: 97, lines: 98 },
        },
      }),
      makeLane("t6", {
        alive: true,
        gate: {
          coverage: { statements: 50, branches: 60, functions: 70, lines: 80 },
        },
      }),
    ]);
    const out = renderStatus(status, { color: true });
    expect(out).toContain("\x1b[31m"); // red: failed, closed, fail, exit 2
    expect(out).toContain("\x1b[32m"); // green: settled, merged, pass, alive, exit 0
    expect(out).toContain("\x1b[33m"); // yellow: pending
    expect(out).toContain("\x1b[36m"); // cyan: started, open
    expect(out).toContain("\x1b[2m"); // dim: header, absent cells, not alive
    expect(out).toContain("\x1b[0m"); // reset after every painted span
  });

  test("open PRs carry a thread token; could-not-ask and nothing-to-ask never share a rendering", () => {
    const out = renderStatus(
      makeStatus([
        makeLane("t0", {
          pr: {
            number: 1,
            state: "open",
            checks: "pass",
            unresolvedThreads: 0,
          },
        }),
        makeLane("t2", {
          pr: {
            number: 2,
            state: "open",
            checks: "pass",
            unresolvedThreads: 3,
          },
        }),
        makeLane("tq", {
          pr: {
            number: 3,
            state: "open",
            checks: "unknown",
            unresolvedThreads: "unknown",
          },
        }),
        makeLane("tn", { pr: { number: 4, state: "open", checks: "none" } }),
        makeLane("tm", {
          pr: { number: 5, state: "merged", checks: "unknown" },
        }),
      ]),
    );
    const row = (id: string) =>
      out.split("\n").find((line) => line.includes(`T/${id}`))!;
    expect(row("t0")).toContain("#1 open pass threads:0");
    expect(row("t2")).toContain("#2 open pass threads:3");
    // The checks word and the threads word differ — a reader can tell the two
    // gaps apart without hovering anything.
    expect(row("tq")).toContain("#3 open unknown threads:?");
    // A payload written before threads were counted (no thread field on an open PR) renders as unmeasured,
    // never as silence that looks like zero.
    expect(row("tn")).toContain("#4 open none threads:?");
    // Merged: threads were never its question. No token, not a fake zero.
    expect(row("tm")).toContain("#5 merged unknown");
    expect(row("tm")).not.toContain("threads:");
  });

  test("thread and unknown tokens are painted the page's warn, zero threads the page's dim", () => {
    const out = renderStatus(
      makeStatus([
        makeLane("t0", {
          pr: {
            number: 1,
            state: "open",
            checks: "pass",
            unresolvedThreads: 0,
          },
        }),
        makeLane("t2", {
          pr: {
            number: 2,
            state: "open",
            checks: "pass",
            unresolvedThreads: 3,
          },
        }),
        makeLane("tq", {
          pr: {
            number: 3,
            state: "open",
            checks: "unknown",
            unresolvedThreads: "unknown",
          },
        }),
      ]),
      { color: true },
    );
    expect(out).toContain("\x1b[2mthreads:0\x1b[0m");
    expect(out).toContain("\x1b[33mthreads:3\x1b[0m");
    expect(out).toContain("\x1b[33munknown\x1b[0m");
    expect(out).toContain("\x1b[33mthreads:?\x1b[0m");
  });

  test("a truncated coloured line keeps its escapes whole and ends reset", () => {
    const out = renderStatus(makeStatus([makeLane("t1", { alive: true })]), {
      color: true,
      width: 6,
    });
    for (const line of out.split("\n")) {
      expect(visibleLength(line)).toBeLessThanOrEqual(6);
    }
    expect(out).toContain("\x1b[0m");
  });

  test("a lane name containing a bare escape character is stripped, not treated as a colour code", () => {
    const out = renderStatus(
      makeStatus([makeLane("e\x1bb", { alive: true })]),
      {
        width: 40,
      },
    );
    expect(out).not.toContain("\x1b");
    expect(out).toContain("eb");
  });

  test("a lane or wave name carrying C0 controls or DEL renders clean, row intact", () => {
    const status: WaveStatus = {
      generatedAt: "2026-09-09T00:00:00Z",
      waves: [
        {
          id: "wa\x1bve",
          lanes: [
            makeLane("evil\x1b[2Jpassed\x0d", {
              wave: "wa\x1bve",
              alive: true,
            }),
            makeLane("del\x7fete", { wave: "wa\x1bve" }),
          ],
        },
      ],
    };
    const out = renderStatus(status);
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("\x0d");
    expect(out).not.toContain("\x7f");
    expect(out).toContain("wave wave");
    expect(out).toContain("wave/evil[2Jpassed");
    expect(out).toContain("wave/delete");
    const evilRow = out
      .split("\n")
      .find((line) => line.includes("wave/evil[2Jpassed"));
    expect(evilRow).toContain("alive");
  });

  test("truncating exactly mid-escape yields no partial sequence and the line ends reset", () => {
    // Width boundary lands at the escape after "ab" — no half a sequence may follow.
    const out = truncate("ab\x1b[2Jcd", 3);
    expect(out.endsWith("\x1b[0m")).toBe(true);
    expect(visibleLength(out)).toBeLessThanOrEqual(3);
    // Every escape that survives truncate is a complete paint SGR, never a raw ESC.
    expect(out).not.toMatch(/\x1b(?!\[[0-9;]*m)/);
    // Incomplete escape at the cut: the ESC and its CSI run are dropped, not echoed.
    expect(truncate("ab\x1b[3", 3)).toBe("ab\x1b[0m");
    // A control byte that stops an incomplete run is dropped with it.
    expect(truncate("ab\x1b[\x7f", 3)).toBe("ab\x1b[0m");
    // Lone ESC at the end: dropped, not left dangling.
    expect(truncate("ab\x1b", 3)).toBe("ab\x1b[0m");
  });

  test("is pure for a lane that is not alive: the wall clock never changes the answer", () => {
    // An alive lane is never judged against a clock, so it cannot show a render
    // that reads one. A dead `started` lane can: it is the case that did.
    const status = makeStatus([
      makeLane("t1", {
        reported: { stage: "dispatch", event: "started", ts: TS },
        alive: false,
      }),
    ]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-07T17:00:10Z"));
      const early = renderStatus(status);
      vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
      expect(renderStatus(status)).toBe(early);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a non-alive started lane past the grace renders the word laneState returns, not a term of its own", () => {
    const lane = makeLane("t1", {
      reported: { stage: "dispatch", event: "started", ts: TS },
      alive: false,
    });
    const nowMs = Date.parse(TS) + 61_000;
    expect(laneState(lane, nowMs)).toBe("unknown");
    const out = renderStatus(makeStatus([lane]), { nowMs });
    expect(out).toContain("dispatch unknown");
    expect(out).not.toContain("stalled");
    expect(renderStatus(makeStatus([lane]), { nowMs, color: true })).toContain(
      "\x1b[33mdispatch unknown\x1b[0m",
    );
  });

  test("a lane whose reported stage is started but process is not alive is overdue, and says so in laneState's word", () => {
    const status = makeStatus([
      makeLane("t1", {
        reported: { stage: "dispatch", event: "started", ts: TS },
        alive: false,
      }),
    ]);
    const outPlain = renderStatus(status, { color: false });
    // The status was collected two days after the event: the word is laneState's.
    expect(outPlain).toContain("dispatch unknown");
    const outColor = renderStatus(status, { color: true });
    expect(outColor).toContain("\x1b[33mdispatch unknown\x1b[0m");
  });

  test("a lane whose reported stage is started and process not alive yet within grace period renders as started", () => {
    const status = makeStatus([
      makeLane("t1", {
        reported: {
          stage: "dispatch",
          event: "started",
          ts: TS,
        },
        alive: false,
      }),
    ]);
    const nowMs = Date.parse(TS) + 30_000;
    const outPlain = renderStatus(status, { color: false, nowMs });
    expect(outPlain).toContain("dispatch started");
    const outColor = renderStatus(status, { color: true, nowMs });
    expect(outColor).toContain("\x1b[36mdispatch started\x1b[0m");
  });

  test("an unreadable timestamp never makes a started lane overdue", () => {
    const lane = makeLane("t1", {
      reported: { stage: "dispatch", event: "started", ts: "invalid-date" },
      alive: false,
    });
    expect(renderStatus(makeStatus([lane]), { nowMs: 1e15 })).toContain(
      "dispatch started",
    );
  });

  test("the plan-review column shows the gate's flag, or — for a lane it says nothing about", () => {
    const status = makeStatus([
      makeLane("t1", { alive: false }),
      {
        ...makeLane("t2", { alive: false }),
        derived: {
          alive: false,
          planReview: "dispatched on an unreviewed row",
        },
      },
    ]);
    const out = renderStatus(status, { color: false });
    expect(out).toContain("plan review");
    expect(out).toContain("dispatched on an unreviewed row");
    const rows = out.split("\n");
    // Both rows end in the (unset) risk column's —, so the plan-review flag
    // is asserted by its own text, mid-row, rather than by where a row ends.
    expect(rows.find((line) => line.includes("T/t1"))).not.toContain(
      "dispatched on an unreviewed row",
    );
    const flagged = rows.find((line) => line.includes("T/t2"));
    expect(flagged).toContain("dispatched on an unreviewed row");
    // The flag is a disagreement in its own words, painted red — never folded into a state.
    const colored = renderStatus(status, { color: true });
    expect(colored).toContain("\x1b[31mdispatched on an unreviewed row\x1b[0m");
  });

  test("the risk column shows the pre-PR-review gate flag, or — for a lane it says nothing about", () => {
    const status = makeStatus([
      makeLane("t1", { alive: false }),
      {
        ...makeLane("t2", { alive: false }),
        derived: {
          alive: false,
          risk: "high-risk PR open without pre-PR review",
        },
      },
    ]);
    const out = renderStatus(status, { color: false });
    expect(out).toContain("risk");
    const rows = out.split("\n");
    expect(rows.find((line) => line.includes("T/t1"))).not.toContain(
      "high-risk PR open without pre-PR review",
    );
    const flagged = rows.find((line) => line.includes("T/t2"));
    expect(flagged).toContain("high-risk PR open without pre-PR review");
    // The flag is shown, never resolved into a state — painted red, like plan review.
    const colored = renderStatus(status, { color: true });
    expect(colored).toContain(
      "\x1b[31mhigh-risk PR open without pre-PR review\x1b[0m",
    );
  });
});

describe("renderStatus — backlog panel", () => {
  const recordedArtifact = {
    version: 1,
    at: "2026-09-13T12:00:00.000Z",
    git: {
      branch: "feat/backlog-panel",
      head: "9f8e7d6c5b4a39281706f5e4d3c2b1a091827364",
    },
    scope: { kind: "full" as const },
    plans: ["docs/planning/a.md"],
    premises: [
      { lane: "B7", plan: "docs/planning/a.md", status: "holds" as const },
      {
        lane: "R3",
        plan: "docs/planning/r3.md",
        status: "stale" as const,
        reason: "already merged",
      },
      { lane: "N8", plan: "docs/planning/n8.md", status: "timed-out" as const },
    ],
  };

  test("no artifact renders 'no plan:verify run recorded', never zero items", () => {
    const status: WaveStatus = {
      generatedAt: TS,
      waves: [],
      backlog: { state: "absent" },
    };
    const out = renderStatus(status, { color: false });
    expect(out).toContain("no plan:verify run recorded");
  });

  test("an unreadable or malformed artifact renders as unknown, not an empty list", () => {
    const status: WaveStatus = {
      generatedAt: TS,
      waves: [],
      backlog: { state: "unknown" },
    };
    const out = renderStatus(status, { color: false });
    expect(out).toContain("backlog: unknown");
  });

  test("a recorded artifact renders provenance prominently (timestamp, branch, head, scope)", () => {
    const status: WaveStatus = {
      generatedAt: TS,
      waves: [],
      backlog: { state: "recorded", artifact: recordedArtifact },
    };
    const out = renderStatus(status, { color: false });
    expect(out).toContain("2026-09-13T12:00:00.000Z");
    expect(out).toContain("feat/backlog-panel");
    expect(out).toContain("9f8e7d6c");
    expect(out).toContain("full run");
    expect(out).toContain("B7 (docs/planning/a.md): holds");
    expect(out).toContain("R3 (docs/planning/r3.md): stale — already merged");
    expect(out).toContain("N8 (docs/planning/n8.md): timed-out");
  });

  test("a partial run is rendered as partial and names its plans, never the whole backlog", () => {
    const partialArtifact = {
      ...recordedArtifact,
      scope: { kind: "partial" as const, plans: ["docs/planning/a.md"] },
    };
    const status: WaveStatus = {
      generatedAt: TS,
      waves: [],
      backlog: { state: "recorded", artifact: partialArtifact },
    };
    const out = renderStatus(status, { color: false });
    expect(out).toContain("partial run");
    expect(out).not.toContain("full run");
    expect(out).toContain("docs/planning/a.md");
  });

  test("a recorded artifact with no premises renders (no premises)", () => {
    const emptyArtifact = {
      ...recordedArtifact,
      premises: [],
    };
    const status: WaveStatus = {
      generatedAt: TS,
      waves: [],
      backlog: { state: "recorded", artifact: emptyArtifact },
    };
    const out = renderStatus(status, { color: false });
    expect(out).toContain("(no premises)");
  });

  test("a recorded artifact renders colored statuses when color is enabled", () => {
    const status: WaveStatus = {
      generatedAt: TS,
      waves: [],
      backlog: { state: "recorded", artifact: recordedArtifact },
    };
    const out = renderStatus(status, { color: true });
    expect(out).toContain("\x1b[36mholds\x1b[0m");
    expect(out).toContain("\x1b[31mstale\x1b[0m");
    expect(out).toContain("\x1b[33mtimed-out\x1b[0m");
  });

  test("artifact values in terminal output are sanitized against control bytes", () => {
    const maliciousArtifact = {
      version: 1,
      at: "2026-09-13T12:00:00.000Z\x1b[2J",
      git: {
        branch: "feat/s5\x07-bad",
        head: "9f8e7d6c\x1b[31m4e5f60718293a4b5c6d7e8f901234567",
      },
      scope: { kind: "full" as const },
      plans: ["docs/planning/a.md"],
      premises: [
        {
          lane: "B7\x1b[1A",
          plan: "docs/p\x00lan.md",
          status: "stale" as const,
          reason: "gap closed\x1b[31m exploit",
        },
      ],
    };
    const status: WaveStatus = {
      generatedAt: TS,
      waves: [],
      backlog: { state: "recorded", artifact: maliciousArtifact },
    };
    const out = renderStatus(status, { color: false });
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("\x07");
    expect(out).not.toContain("\x00");
    expect(out).toContain(
      "B7[1A (docs/plan.md): stale — gap closed[31m exploit",
    );
    expect(out).toContain("feat/s5-bad");
    expect(out).toContain("2026-09-13T12:00:00.000Z[2J");
  });

  test("a partial run's plan list is sanitized too, not just the premise rows", () => {
    const status: WaveStatus = {
      generatedAt: TS,
      waves: [],
      backlog: {
        state: "recorded",
        artifact: {
          version: 1,
          at: "2026-09-13T12:00:00.000Z",
          git: {
            branch: "main",
            head: "9f8e7d6c5b4a39281706f5e4d3c2b1a091827364",
          },
          scope: {
            kind: "partial" as const,
            plans: ["docs/planning/a\x1b[2J.md"],
          },
          plans: ["docs/planning/a\x1b[2J.md"],
          premises: [],
        },
      },
    };
    const out = renderStatus(status, { color: false });
    expect(out).not.toContain("\x1b");
    expect(out).toContain("partial run (docs/planning/a[2J.md)");
  });
});
