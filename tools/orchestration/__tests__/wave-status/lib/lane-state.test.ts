import {
  laneState,
  laneNeedsHuman,
  laneStateCounts,
  laneEvidenceMs,
  isPastWaveLane,
  hasFreshActionableSignal,
  stallThresholdMs,
  pastWaveThresholdMs,
  LANE_STATES,
  NEEDS_HUMAN_STATES,
  isNeedsHumanState,
} from "../../../src/wave-status/lib/lane-state.js";
import type { LaneStatus } from "../../../src/internal/wave-types.js";
import { it, expect } from "vitest";

type PartialLaneStatus = Omit<Partial<LaneStatus>, "derived"> & {
  derived?: Partial<LaneStatus["derived"]>;
  disagreements?: string[];
};

function makeStatus(overrides: PartialLaneStatus = {}): LaneStatus {
  const base: LaneStatus = {
    wave: "test",
    lane: "test",
    disagreements: [],
    derived: {
      alive: false,
    },
  };
  const derived = { ...base.derived, ...overrides.derived } as any;
  return {
    ...base,
    ...overrides,
    derived,
  } as any as LaneStatus;
}

const now = Date.now();

// Helper to set log mtime
function withLog(status: LaneStatus, mtime: number): LaneStatus {
  return {
    ...status,
    derived: {
      ...status.derived,
      log: { bytes: 0, mtimeMs: mtime, tail: "" },
    },
  };
}

// Tests for each state

it("conflict", () => {
  const s = makeStatus({ disagreements: ["a"] });
  expect(laneState(s, now)).toBe("conflict");
});

it("failed", () => {
  const s = makeStatus({ derived: { exit: 1, alive: false } });
  expect(laneState(s, now)).toBe("failed");
});

it("stalled", () => {
  const s = makeStatus({ derived: { alive: true } });
  const s2 = withLog(s, now - stallThresholdMs - 1);
  expect(laneState(s2, now)).toBe("stalled");
});

it("running", () => {
  const s = makeStatus({ derived: { alive: true } });
  const s2 = withLog(s, now - stallThresholdMs + 1);
  expect(laneState(s2, now)).toBe("running");
});

it("boundary: log mtime exactly at stall threshold is running (< reads strictly older)", () => {
  const s = makeStatus({ derived: { alive: true } });
  const s2 = withLog(s, now - stallThresholdMs);
  expect(laneState(s2, now)).toBe("running");
});

it("vanished", () => {
  const s = makeStatus({});
  expect(laneState(s, now)).toBe("vanished");
});

// The silent no-op exits 0: a run that billed and produced nothing.
// A lane that is not alive and has no PR is vanished, whatever its exit code.
it("vanished when exit is zero and not alive (silent no-op)", () => {
  const s = makeStatus({ derived: { alive: false, exit: 0 } });
  expect(laneState(s, now)).toBe("vanished");
});

// `vanished` must mean something bad — a lane that ended and left no PR
// behind. A lane whose last words were `started`, with nothing since, is not
// evidence of a disappearance; it is the absence of evidence, and the ranking
// already owns the word for that: unknown. The live case from the owner's
// session: twelve `started` events, no terminal event, no PR — all rendered
// vanished, an accusation the inputs cannot pay for.
it("a started event with nothing after it is unknown, not vanished", () => {
  const s = makeStatus({
    reported: {
      stage: "implement",
      event: "started",
      ts: new Date(now - 60_000).toISOString(),
    },
    derived: { alive: false },
  });
  expect(laneState(s, now)).toBe("unknown");
});

it("unknown for a silent start does not undo vanished for a silent ending", () => {
  // The EXIT 0 arm: the log says the run finished, and no PR exists — that is
  // the bad thing `vanished` names, event or no event.
  const withExit = makeStatus({
    reported: {
      stage: "implement",
      event: "started",
      ts: new Date(now).toISOString(),
    },
    derived: { alive: false, exit: 0 },
  });
  expect(laneState(withExit, now)).toBe("vanished");
  // A terminal `settled` with no PR is likewise the ending the page cannot
  // substantiate — and it is the events-only shape no hang disagreement fires on.
  const settled = makeStatus({
    reported: {
      stage: "implement",
      event: "settled",
      ts: new Date(now).toISOString(),
    },
    derived: { alive: false },
  });
  expect(laneState(settled, now)).toBe("vanished");
});

it("laneEvidenceMs takes the newest dated artefact, and invents nothing", () => {
  // No log, no event: nothing can be said about age.
  expect(laneEvidenceMs(makeStatus({}))).toBeUndefined();
  // An unparseable event ts is not a measurement either.
  expect(
    laneEvidenceMs(
      makeStatus({
        reported: { stage: "gate", event: "started", ts: "now" },
        derived: { alive: false },
      }),
    ),
  ).toBeUndefined();
  const logMs = now - 10 * 60_000;
  expect(laneEvidenceMs(withLog(makeStatus({}), logMs))).toBe(logMs);
  const eventMs = now - 2 * 60_000;
  const both = withLog(
    makeStatus({
      reported: {
        stage: "implement",
        event: "started",
        ts: new Date(eventMs).toISOString(),
      },
    }),
    logMs,
  );
  // The newest artefact answers "when was anything last true of this lane".
  expect(laneEvidenceMs(both)).toBe(eventMs);
});

it("isPastWaveLane: silence older than the threshold belongs to a past wave, to the millisecond", () => {
  const oldLog = withLog(makeStatus({}), now - pastWaveThresholdMs - 1);
  expect(isPastWaveLane(oldLog, now)).toBe(true);
  // Strictly greater: exactly at the threshold is still this wave.
  expect(
    isPastWaveLane(withLog(makeStatus({}), now - pastWaveThresholdMs), now),
  ).toBe(false);
  // Undated is not old — absence of a date buys no accusation.
  expect(isPastWaveLane(makeStatus({}), now)).toBe(false);
  // Events alone date a lane too: the old wave with no logs still reads past.
  const oldEvent = makeStatus({
    reported: {
      stage: "implement",
      event: "started",
      ts: new Date(now - pastWaveThresholdMs - 1).toISOString(),
    },
    derived: { alive: false },
  });
  expect(isPastWaveLane(oldEvent, now)).toBe(true);
});

it("blocked", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "pending" },
    },
  });
  expect(laneState(s, now)).toBe("blocked");
});

// Every PR spends its first few seconds exactly like this: it exists, and CI
// has reported nothing yet. `checks: "none"` is waiting for a verdict that has
// not started — the same thing `blocked` already names — not a throw.
it("open PR with checks none is blocked, not an unhandled state", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "none" },
    },
  });
  expect(laneState(s, now)).toBe("blocked");
});

// The collector does hand back closed PRs, and the ranking has no verdict for
// one. Name the gap instead of guessing a state: an unnamed state is a
// question, a wrong state is a lie.
it("closed PR is unknown, not a guess", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "closed", checks: "none" },
    },
  });
  expect(laneState(s, now)).toBe("unknown");
});

it("merged PR with checks none is still merged", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "merged", checks: "none" },
    },
  });
  expect(laneState(s, now)).toBe("merged");
});

it("ready", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "pass", unresolvedThreads: 0 },
    },
  });
  expect(laneState(s, now)).toBe("ready");
});

// H1: the fact that separates "CI is green" from "this can merge". A measured
// unresolved thread blocks, whatever the checks say — ready is earned by both
// measurements being affirmative, not by one.
it("green checks with an unresolved review thread is blocked, not ready", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "pass", unresolvedThreads: 2 },
    },
  });
  expect(laneState(s, now)).toBe("blocked");
});

it("unresolved threads block while checks are pending too", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "pending", unresolvedThreads: 1 },
    },
  });
  expect(laneState(s, now)).toBe("blocked");
});

// The precedence decision, stated and pinned: a *measured* blocker outranks
// a *missing measurement*. "Could not ask" about checks must not hide the
// threads we did manage to count.
it("unresolved threads outrank a checks read that could not be taken", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "unknown", unresolvedThreads: 1 },
    },
  });
  expect(laneState(s, now)).toBe("blocked");
});

// The other half of the decision: could-not-ask must NOT read as blocked.
// blocked asserts something is in the way; this value asserts we do not know.
// It lands on the word introduced for "no verdict" — unknown.
it("open PR whose checks could not be asked is unknown, not blocked", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "unknown", unresolvedThreads: 0 },
    },
  });
  expect(laneState(s, now)).toBe("unknown");
});

it("green checks with an unmeasured thread state is unknown, not ready", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: {
        number: 1,
        state: "open",
        checks: "pass",
        unresolvedThreads: "unknown",
      },
    },
  });
  expect(laneState(s, now)).toBe("unknown");
});

// An open PR with no thread field at all is a payload written before threads were counted (a cached
// corpus, an older payload). The page and this function both read absence as
// *no measurement* — unknown, never the ready the field's absence used to
// imply.
it("green checks with no thread measurement in the payload is unknown, not ready", () => {
  const s = makeStatus({
    derived: { alive: false, pr: { number: 1, state: "open", checks: "pass" } },
  });
  expect(laneState(s, now)).toBe("unknown");
});

it("checks unknown with threads unknown is unknown — two gaps do not make a verdict", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: {
        number: 1,
        state: "open",
        checks: "unknown",
        unresolvedThreads: "unknown",
      },
    },
  });
  expect(laneState(s, now)).toBe("unknown");
});

it("merged", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "merged", checks: "pass" },
    },
  });
  expect(laneState(s, now)).toBe("merged");
});

// gate.exit non-zero without derived.exit -> failed
it("gate.exit non-zero without derived.exit -> failed", () => {
  const s = makeStatus({ derived: { alive: false, gate: { exit: 1 } } });
  expect(laneState(s, now)).toBe("failed");
});
// gate.exit non-zero with derived.exit === 0 -> failed
it("gate.exit non-zero with derived.exit === 0 -> failed", () => {
  const s = makeStatus({
    derived: { alive: false, exit: 0, gate: { exit: 2 } },
  });
  expect(laneState(s, now)).toBe("failed");
});
// pr.checks fail on open PR -> failed
it("pr.checks fail on open PR -> failed", () => {
  const s = makeStatus({
    derived: { alive: false, pr: { number: 1, state: "open", checks: "fail" } },
  });
  expect(laneState(s, now)).toBe("failed");
});
// failed outranks blocked and ready
it("failed outranks blocked and ready", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      gate: { exit: 1 },
      pr: { number: 1, state: "open", checks: "pending" },
    },
  });
  expect(laneState(s, now)).toBe("failed");
});
// Precedence tests

it("conflict overrides failed", () => {
  const s = makeStatus({
    disagreements: ["a"],
    derived: { exit: 1, alive: false },
  });
  expect(laneState(s, now)).toBe("conflict");
});

it("conflict overrides running", () => {
  const s = makeStatus({
    disagreements: ["a"],
    derived: { alive: true },
  });
  expect(laneState(s, now)).toBe("conflict");
});

it("failed overrides running", () => {
  const s = makeStatus({
    derived: { exit: 1, alive: true },
  });
  expect(laneState(s, now)).toBe("failed");
});

it("stalled overrides running", () => {
  const s = makeStatus({
    derived: { alive: true },
  });
  const s2 = withLog(s, now - stallThresholdMs - 1);
  expect(laneState(s2, now)).toBe("stalled");
});

// The rollup: per-wave and page counts are `laneStateCounts` over the lanes,
// bucketed by `laneState` — the very function the row's leading cell reads. So
// the count of `running` here is the count of rows that will render `running`,
// by construction: one computation, not two that must be kept in step.
it("laneStateCounts buckets every state once each, keyed by LANE_STATES", () => {
  const oneOfEach: LaneStatus[] = [
    makeStatus({ disagreements: ["a"] }), // conflict
    makeStatus({ derived: { alive: false, exit: 1 } }), // failed
    withLog(
      makeStatus({ derived: { alive: true } }),
      now - stallThresholdMs - 1,
    ), // stalled
    withLog(
      makeStatus({ derived: { alive: true } }),
      now - stallThresholdMs + 1,
    ), // running
    makeStatus({ derived: { alive: false } }), // vanished
    makeStatus({
      derived: {
        alive: false,
        pr: { number: 1, state: "open", checks: "pending" },
      },
    }), // blocked
    makeStatus({
      derived: {
        alive: false,
        pr: { number: 1, state: "open", checks: "pass", unresolvedThreads: 0 },
      },
    }), // ready
    makeStatus({
      derived: {
        alive: false,
        pr: { number: 1, state: "merged", checks: "pass" },
      },
    }), // merged
    makeStatus({
      derived: {
        alive: false,
        pr: { number: 1, state: "closed", checks: "none" },
      },
    }), // unknown
  ];
  expect(laneStateCounts(oneOfEach, now)).toEqual({
    conflict: 1,
    failed: 1,
    stalled: 1,
    running: 1,
    vanished: 1,
    blocked: 1,
    ready: 1,
    merged: 1,
    unknown: 1,
  });
  // Every state is a key — a known zero, not a missing one — and the keys are
  // exactly LANE_STATES, so the rollup can never be shown a state it cannot name.
  expect(Object.keys(laneStateCounts(oneOfEach, now)).sort()).toEqual(
    [...LANE_STATES].sort(),
  );
});

it("laneStateCounts tallies repeats and sums to the lanes given", () => {
  const running = makeStatus({ derived: { alive: true } });
  const merged = makeStatus({
    derived: {
      alive: false,
      pr: { number: 2, state: "merged", checks: "none" },
    },
  });
  const counts = laneStateCounts([running, running, running, merged], now);
  expect(counts.running).toBe(3);
  expect(counts.merged).toBe(1);
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(4);
});

it("laneStateCounts of no lanes is every state at zero — a known nothing, not a blank", () => {
  const empty = laneStateCounts([], now);
  expect(Object.values(empty)).toEqual(LANE_STATES.map(() => 0));
});

// The *hide inactive* set: what a human is wanted for. The page mirrors this list
// and a test holds them to the same fixture; here it is the rule stated once.
it("isNeedsHumanState names exactly the states a human is wanted for", () => {
  for (const state of NEEDS_HUMAN_STATES) {
    expect(isNeedsHumanState(state)).toBe(true);
  }
  for (const state of LANE_STATES) {
    const wants = NEEDS_HUMAN_STATES.includes(state);
    expect(isNeedsHumanState(state)).toBe(wants);
  }
});

// Finding 1: needs-a-human is a fact about the lane, not only about its state
// word. `blocked` cannot join NEEDS_HUMAN_STATES — a CI-only block waits on
// the pipeline, not on a person — but a block whose cause is a *counted*
// positive unresolved-thread count is a review somebody owes, and it is
// exactly the thing the attention view exists to surface. The lane-aware
// predicate reads the count; the page mirrors it, pinned by page.test.ts.
it("laneNeedsHuman: the four needs-a-human states need a human whatever the lane carries", () => {
  expect(laneNeedsHuman(makeStatus({ disagreements: ["a"] }), now)).toBe(true);
  expect(laneNeedsHuman(makeStatus({ derived: { exit: 1 } }), now)).toBe(true);
  const stalled = withLog(
    makeStatus({ derived: { alive: true } }),
    now - stallThresholdMs - 1,
  );
  expect(laneNeedsHuman(stalled, now)).toBe(true);
  const running = withLog(
    makeStatus({ derived: { alive: true } }),
    now - stallThresholdMs + 1,
  );
  expect(laneNeedsHuman(running, now)).toBe(true);
});

it("laneNeedsHuman: blocked by a counted unresolved thread needs a human", () => {
  const s = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "pass", unresolvedThreads: 2 },
    },
  });
  expect(laneState(s, now)).toBe("blocked");
  expect(laneNeedsHuman(s, now)).toBe(true);
});

it("laneNeedsHuman: blocked by CI alone does not need a human", () => {
  const threadsZero = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "pending", unresolvedThreads: 0 },
    },
  });
  expect(laneNeedsHuman(threadsZero, now)).toBe(false);
  const threadsAbsent = makeStatus({
    derived: { alive: false, pr: { number: 1, state: "open", checks: "none" } },
  });
  expect(laneNeedsHuman(threadsAbsent, now)).toBe(false);
  const threadsUnknown = makeStatus({
    derived: {
      alive: false,
      pr: {
        number: 1,
        state: "open",
        checks: "pending",
        unresolvedThreads: "unknown",
      },
    },
  });
  expect(laneNeedsHuman(threadsUnknown, now)).toBe(false);
});

// give `isPastWaveLane` its consumer. A wave whose newest evidence is
// a day old is history, not a current emergency — the header must stop
// promising a human is wanted over it. The decision: suppress
// only the *classification*, never the state itself — a lane that really
// disagreed with itself still says `conflict` in its row; only the count a
// person acts on lets it go.
it("laneNeedsHuman: a disagreement past its wave still says conflict in its row, but stops needing a human", () => {
  const old = withLog(
    makeStatus({ disagreements: ["a"] }),
    now - pastWaveThresholdMs - 1,
  );
  expect(isPastWaveLane(old, now)).toBe(true);
  expect(laneState(old, now)).toBe("conflict");
  expect(laneNeedsHuman(old, now)).toBe(false);
});

// The boundary the other way: the same shape, evidence inside the threshold,
// is still counted — this cannot pass by disabling the feature outright.
it("laneNeedsHuman: the same disagreement with evidence inside the threshold is still counted", () => {
  const recent = withLog(
    makeStatus({ disagreements: ["a"] }),
    now - pastWaveThresholdMs + 1,
  );
  expect(isPastWaveLane(recent, now)).toBe(false);
  expect(laneNeedsHuman(recent, now)).toBe(true);
});

// A day-old failed lane with no other fresh fact stops needing a human,
// exactly as the disagreement case above.
it("laneNeedsHuman: a past-wave failed lane with no fresh signal stops needing a human", () => {
  const pastFailed = withLog(
    makeStatus({ derived: { alive: false, exit: 1 } }),
    now - pastWaveThresholdMs - 1,
  );
  expect(laneState(pastFailed, now)).toBe("failed");
  expect(hasFreshActionableSignal(pastFailed)).toBe(false);
  expect(laneNeedsHuman(pastFailed, now)).toBe(false);
});

// `alive` and a PR's `checks`/`unresolvedThreads` are live
// probes re-read every collection (collect.ts) — a different, and often
// fresher, set of facts than the dated evidence `laneEvidenceMs` reads. The
// past-wave guard must yield to any of the three, or it drops exactly the
// lanes an operator most needs to see.
it("hasFreshActionableSignal: alive, a failing open PR, or a counted unresolved thread are fresh; a merged PR and 'could not ask' are not", () => {
  expect(
    hasFreshActionableSignal(makeStatus({ derived: { alive: true } })),
  ).toBe(true);
  expect(
    hasFreshActionableSignal(
      makeStatus({
        derived: {
          alive: false,
          pr: { number: 1, state: "open", checks: "fail" },
        },
      }),
    ),
  ).toBe(true);
  expect(
    hasFreshActionableSignal(
      makeStatus({
        derived: {
          alive: false,
          pr: {
            number: 1,
            state: "open",
            checks: "pass",
            unresolvedThreads: 3,
          },
        },
      }),
    ),
  ).toBe(true);
  expect(
    hasFreshActionableSignal(
      makeStatus({
        derived: {
          alive: false,
          pr: { number: 1, state: "merged", checks: "pass" },
        },
      }),
    ),
  ).toBe(false);
  expect(
    hasFreshActionableSignal(
      makeStatus({
        derived: {
          alive: false,
          pr: {
            number: 1,
            state: "open",
            checks: "unknown",
            unresolvedThreads: "unknown",
          },
        },
      }),
    ),
  ).toBe(false);
  expect(
    hasFreshActionableSignal(makeStatus({ derived: { alive: false } })),
  ).toBe(false);
});

// Rescue path 1: a live process outranks a day-old log — the `stalled` case
// an operator most needs to see, which the unconditional guard used to hide.
it("laneNeedsHuman: a live process outranks a day-old log — the stalled case a past wave must not hide", () => {
  const staleButAlive = withLog(
    makeStatus({ derived: { alive: true } }),
    now - pastWaveThresholdMs - 1,
  );
  expect(isPastWaveLane(staleButAlive, now)).toBe(true);
  expect(laneState(staleButAlive, now)).toBe("stalled");
  expect(laneNeedsHuman(staleButAlive, now)).toBe(true);
});

// Rescue path 2: an open PR that just failed its checks outranks a day-old
// lane — a rebase can break a PR long after the lane itself went quiet.
it("laneNeedsHuman: an open PR that just failed its checks outranks a day-old lane", () => {
  const s = withLog(
    makeStatus({
      derived: {
        alive: false,
        pr: { number: 1, state: "open", checks: "fail" },
      },
    }),
    now - pastWaveThresholdMs - 1,
  );
  expect(isPastWaveLane(s, now)).toBe(true);
  expect(laneState(s, now)).toBe("failed");
  expect(laneNeedsHuman(s, now)).toBe(true);
});

// Rescue path 3: an open PR with an unresolved thread right now outranks a
// day-old lane — a reviewer's comment does not age with the lane's log.
it("laneNeedsHuman: an open PR with an unresolved thread right now outranks a day-old lane", () => {
  const s = withLog(
    makeStatus({
      derived: {
        alive: false,
        pr: { number: 1, state: "open", checks: "pass", unresolvedThreads: 2 },
      },
    }),
    now - pastWaveThresholdMs - 1,
  );
  expect(isPastWaveLane(s, now)).toBe(true);
  expect(laneState(s, now)).toBe("blocked");
  expect(laneNeedsHuman(s, now)).toBe(true);
});

// The negative that keeps the feature real: nothing is fresh — not alive,
// and the PR is merged, so its checks and threads are no longer live
// questions — so a day-old lane is still suppressed, whatever its state.
it("laneNeedsHuman: with nothing fresh to report, a day-old lane stays suppressed past a merged PR", () => {
  const s = withLog(
    makeStatus({
      derived: {
        alive: false,
        exit: 1,
        pr: { number: 1, state: "merged", checks: "pass" },
      },
    }),
    now - pastWaveThresholdMs - 1,
  );
  expect(isPastWaveLane(s, now)).toBe(true);
  expect(laneState(s, now)).toBe("failed");
  expect(hasFreshActionableSignal(s)).toBe(false);
  expect(laneNeedsHuman(s, now)).toBe(false);
});

// The decision, pinned: `checks: "unknown"` is "could not ask", not a
// verdict. Treating it as actionable would revive every past-wave lane the
// moment one API read failed — this stays suppressed, unlike the identical
// shape with `checks: "fail"` above.
it("laneNeedsHuman: an open PR whose checks could not be asked does not rescue a day-old lane", () => {
  const s = withLog(
    makeStatus({
      derived: {
        alive: false,
        pr: {
          number: 1,
          state: "open",
          checks: "unknown",
          unresolvedThreads: 0,
        },
      },
    }),
    now - pastWaveThresholdMs - 1,
  );
  expect(isPastWaveLane(s, now)).toBe(true);
  expect(hasFreshActionableSignal(s)).toBe(false);
  expect(laneNeedsHuman(s, now)).toBe(false);
});

// Silence must not be read as age: an unparseable `ts` and no log leave
// `laneEvidenceMs` undefined, so the lane is not past-wave and a live-looking
// failure keeps needing a human.
it("laneNeedsHuman: an unparseable ts with no log is not past-wave — silence is counted, not aged out", () => {
  const silent = makeStatus({
    reported: { stage: "gate", event: "started", ts: "not-a-date" },
    derived: { alive: false, exit: 1 },
  });
  expect(laneEvidenceMs(silent)).toBeUndefined();
  expect(isPastWaveLane(silent, now)).toBe(false);
  expect(laneState(silent, now)).toBe("failed");
  expect(laneNeedsHuman(silent, now)).toBe(true);
});

it("laneNeedsHuman: the quiet states never need a human, gap or no gap", () => {
  const ready = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "open", checks: "pass", unresolvedThreads: 0 },
    },
  });
  expect(laneNeedsHuman(ready, now)).toBe(false);
  const merged = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "merged", checks: "pass" },
    },
  });
  expect(laneNeedsHuman(merged, now)).toBe(false);
  // No PR at all: the `undefined` arm of the thread read must be reachable
  // and must answer "not a person's problem", never throw.
  expect(laneNeedsHuman(makeStatus({}), now)).toBe(false);
  const closed = makeStatus({
    derived: {
      alive: false,
      pr: { number: 1, state: "closed", checks: "none" },
    },
  });
  expect(laneNeedsHuman(closed, now)).toBe(false);
  const unasked = makeStatus({
    derived: {
      alive: false,
      pr: {
        number: 1,
        state: "open",
        checks: "unknown",
        unresolvedThreads: "unknown",
      },
    },
  });
  expect(laneNeedsHuman(unasked, now)).toBe(false);
});
