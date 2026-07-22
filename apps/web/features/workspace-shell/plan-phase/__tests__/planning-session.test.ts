import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  initialSessionState,
  planningSessionReducer as reduce,
  sessionStateFromLayer,
  roleForStatus,
  DEFAULT_MAX_ROUNDS,
  type PlanningSessionState,
} from "../session/planning-session";

describe("planningSessionReducer", () => {
  it("initial state: proposing, round 1, proposer next, default cap", () => {
    const s = initialSessionState();
    assert.strictEqual(s.status, "proposing");
    assert.strictEqual(s.round, 1);
    assert.strictEqual(s.maxRounds, DEFAULT_MAX_ROUNDS);
    assert.strictEqual(s.nextRole, "proposer");
  });

  it("guards a nonsense maxRounds back to the default", () => {
    assert.strictEqual(initialSessionState(0).maxRounds, DEFAULT_MAX_ROUNDS);
    assert.strictEqual(initialSessionState(-3).maxRounds, DEFAULT_MAX_ROUNDS);
    assert.strictEqual(initialSessionState(6).maxRounds, 6);
  });

  it("happy path: proposing → critiquing → converged → finalizing → done", () => {
    let s = initialSessionState();
    s = reduce(s, { type: "PROPOSAL_DONE" });
    assert.strictEqual(s.status, "critiquing");
    assert.strictEqual(s.nextRole, "critic");
    s = reduce(s, { type: "CRITIQUE_DONE", verdict: "converged" });
    assert.strictEqual(s.status, "converged");
    s = reduce(s, { type: "FINALIZE_START" });
    assert.strictEqual(s.status, "finalizing");
    s = reduce(s, { type: "FINALIZE_DONE" });
    assert.strictEqual(s.status, "done");
  });

  it("CONTINUE verdict loops revising ⇄ critiquing and increments the round", () => {
    let s = initialSessionState();
    s = reduce(s, { type: "PROPOSAL_DONE" });
    s = reduce(s, { type: "CRITIQUE_DONE", verdict: "continue" });
    assert.strictEqual(s.status, "revising");
    assert.strictEqual(s.round, 2);
    assert.strictEqual(s.nextRole, "proposer");
    s = reduce(s, { type: "PROPOSAL_DONE" });
    assert.strictEqual(s.status, "critiquing");
    s = reduce(s, { type: "CRITIQUE_DONE", verdict: "continue" });
    assert.strictEqual(s.round, 3);
  });

  it("round cap: CONTINUE at round === maxRounds parks in awaiting-human, not another burn", () => {
    let s = initialSessionState(2);
    // round 1
    s = reduce(s, { type: "PROPOSAL_DONE" });
    s = reduce(s, { type: "CRITIQUE_DONE", verdict: "continue" });
    assert.strictEqual(s.round, 2);
    // round 2 (== cap)
    s = reduce(s, { type: "PROPOSAL_DONE" });
    s = reduce(s, { type: "CRITIQUE_DONE", verdict: "continue" });
    assert.strictEqual(s.status, "awaiting-human");
    assert.strictEqual(s.awaitReason, "cap-reached");
    assert.strictEqual(s.round, 2, "round does not advance past the cap");
  });

  it("RESUME after cap-reached is an explicit human extension (round + 1, revising)", () => {
    let s: PlanningSessionState = {
      ...initialSessionState(2),
      status: "awaiting-human",
      round: 2,
      awaitReason: "cap-reached",
      resumeStatus: "revising",
    };
    s = reduce(s, { type: "RESUME" });
    assert.strictEqual(s.status, "revising");
    assert.strictEqual(s.round, 3);
    assert.strictEqual(s.awaitReason, undefined);
  });

  it("PAUSE from any active state parks awaiting-human and RESUME returns to it", () => {
    for (const active of ["proposing", "critiquing", "revising"] as const) {
      let s: PlanningSessionState = {
        ...initialSessionState(),
        status: active,
      };
      s = reduce(s, { type: "PAUSE" });
      assert.strictEqual(s.status, "awaiting-human");
      assert.strictEqual(s.awaitReason, "paused");
      assert.strictEqual(s.nextRole, roleForStatus(active));
      s = reduce(s, { type: "RESUME" });
      assert.strictEqual(s.status, active, `resumes back into ${active}`);
      assert.strictEqual(s.round, 1, "plain pause does not extend the round");
    }
  });

  it("ERROR from an active state parks awaiting-human with the message — never a silent stall", () => {
    let s = initialSessionState();
    s = reduce(s, { type: "ERROR", message: "stream died" });
    assert.strictEqual(s.status, "awaiting-human");
    assert.strictEqual(s.awaitReason, "error");
    assert.strictEqual(s.errorMessage, "stream died");
    s = reduce(s, { type: "RESUME" });
    assert.strictEqual(s.status, "proposing", "resume re-runs the failed role");
    assert.strictEqual(s.errorMessage, undefined);
  });

  it("FORCE_CONVERGE works from active and awaiting-human states", () => {
    for (const status of [
      "proposing",
      "critiquing",
      "revising",
      "awaiting-human",
    ] as const) {
      const s = reduce(
        { ...initialSessionState(), status },
        { type: "FORCE_CONVERGE" },
      );
      assert.strictEqual(s.status, "converged", `from ${status}`);
    }
  });

  it("END is terminal from anywhere non-done", () => {
    for (const status of [
      "proposing",
      "critiquing",
      "revising",
      "awaiting-human",
      "converged",
      "finalizing",
    ] as const) {
      const s = reduce({ ...initialSessionState(), status }, { type: "END" });
      assert.strictEqual(s.status, "done", `from ${status}`);
    }
  });

  it("invalid events return the SAME state reference (identity no-op)", () => {
    const proposing = initialSessionState();
    assert.strictEqual(
      reduce(proposing, { type: "CRITIQUE_DONE", verdict: "converged" }),
      proposing,
      "critique cannot land while proposing",
    );
    assert.strictEqual(
      reduce(proposing, { type: "FINALIZE_START" }),
      proposing,
      "cannot finalize before convergence",
    );
    assert.strictEqual(
      reduce(proposing, { type: "RESUME" }),
      proposing,
      "resume only applies to awaiting-human",
    );
    const done: PlanningSessionState = { ...proposing, status: "done" };
    assert.strictEqual(reduce(done, { type: "END" }), done);
    assert.strictEqual(reduce(done, { type: "PAUSE" }), done);
    assert.strictEqual(
      reduce(done, { type: "ERROR", message: "late" }),
      done,
      "a straggler error cannot resurrect a done session",
    );
    assert.strictEqual(reduce(done, { type: "FORCE_CONVERGE" }), done);
  });
});

describe("sessionStateFromLayer (interrupted-session recovery)", () => {
  it("recovers round from the highest persisted turn round", () => {
    const s = sessionStateFromLayer({
      status: "awaiting-human",
      maxRounds: 4,
      turns: [{ round: 1 }, { round: 2 }, {}],
    });
    assert.strictEqual(s.round, 2);
    assert.strictEqual(s.maxRounds, 4);
  });

  it("maps a persisted ACTIVE status to awaiting-human (interrupted) with resume back into it", () => {
    const s = sessionStateFromLayer({ status: "critiquing", turns: [] });
    assert.strictEqual(s.status, "awaiting-human");
    assert.strictEqual(s.awaitReason, "paused");
    assert.strictEqual(s.resumeStatus, "critiquing");
  });

  it("keeps terminal/converged statuses as-is", () => {
    assert.strictEqual(
      sessionStateFromLayer({ status: "converged", turns: [] }).status,
      "converged",
    );
    assert.strictEqual(
      sessionStateFromLayer({ status: "done", turns: [] }).status,
      "done",
    );
  });

  it("a persisted `revising` recovers one round AHEAD of the highest turn stamp", () => {
    // CRITIQUE_DONE(continue) advances the in-memory round to k+1 while the
    // round-k critic turn + `revising` status land in one write — so the
    // stored turns lag the live round by one.
    const s = sessionStateFromLayer({
      status: "revising",
      maxRounds: 4,
      turns: [
        { role: "proposer", round: 2 },
        { role: "critic", round: 2 },
      ],
    });
    assert.strictEqual(s.round, 3);
    // ACTIVE persisted status + no loop = interrupted → parked.
    assert.strictEqual(s.status, "awaiting-human");
    assert.strictEqual(s.resumeStatus, "revising");
  });

  it("a persisted `finalizing` recovers as converged (the distill is stateless and re-runnable)", () => {
    const s = sessionStateFromLayer({
      status: "finalizing",
      turns: [{ role: "critic", round: 2 }],
    });
    assert.strictEqual(s.status, "converged");
    assert.strictEqual(s.round, 2);
  });

  it("derives a cap-park: awaiting-human whose last model turn is a critic at round >= maxRounds", () => {
    const s = sessionStateFromLayer({
      status: "awaiting-human",
      maxRounds: 4,
      turns: [
        { role: "proposer", round: 4 },
        { role: "critic", round: 4 },
        // trailing human steering doesn't mask the cap-park
        { role: "human" },
      ],
    });
    assert.strictEqual(s.awaitReason, "cap-reached");
    assert.strictEqual(
      s.resumeStatus,
      "revising",
      "Resume keeps its round-extension semantics",
    );
  });

  it("an awaiting-human below the cap recovers as a plain pause", () => {
    const s = sessionStateFromLayer({
      status: "awaiting-human",
      maxRounds: 4,
      turns: [
        { role: "proposer", round: 2 },
        { role: "critic", round: 2 },
      ],
    });
    assert.strictEqual(s.awaitReason, "paused");
    assert.strictEqual(s.resumeStatus, "proposing");
  });
});
