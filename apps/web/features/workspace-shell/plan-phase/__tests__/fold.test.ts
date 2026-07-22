import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { buildFold, humanTurnsSinceLastModelTurn } from "../session/fold";
import type { ProjectLayerTurn } from "@hexagen/shared";

const turn = (
  role: ProjectLayerTurn["role"],
  content: string,
): ProjectLayerTurn => ({
  id: `id-${content}`,
  author: role ?? "?",
  content,
  role,
});

describe("buildFold", () => {
  it("first proposer turn: preamble + round + brief only (nothing to fold yet)", () => {
    // Real shape: the seed IS turns[0] (a human turn) — it must appear as the
    // Brief only, never doubled as a "Human steering" note.
    const fold = buildFold({
      role: "proposer",
      seed: "A booking platform for climbing gyms",
      turns: [turn("human", "A booking platform for climbing gyms")],
      round: 1,
      maxRounds: 4,
    });
    assert.match(fold, /You are the PROPOSER/);
    assert.match(fold, /Round 1 of 4\./);
    assert.match(fold, /## Brief\nA booking platform for climbing gyms/);
    assert.doesNotMatch(fold, /## Latest proposal/);
    assert.doesNotMatch(fold, /## Latest critique/);
    assert.doesNotMatch(fold, /## Human steering/);
  });

  it("steering added before any model turn (paused first turn) IS folded — only the seed is excluded", () => {
    const fold = buildFold({
      role: "proposer",
      seed: "the brief",
      turns: [turn("human", "the brief"), turn("human", "use event sourcing")],
      round: 1,
      maxRounds: 4,
    });
    assert.match(fold, /## Human steering \(must be honored\)/);
    assert.match(fold, /- use event sourcing/);
    assert.doesNotMatch(fold, /- the brief/);
  });

  it("critic turn folds the LATEST proposal (not older ones) and requires the verdict contract", () => {
    const fold = buildFold({
      role: "critic",
      seed: "seed",
      turns: [
        turn("proposer", "old proposal"),
        turn("proposer", "new proposal"),
      ],
      round: 1,
      maxRounds: 4,
    });
    assert.match(fold, /You are the CRITIC/);
    assert.match(fold, /VERDICT: CONVERGED/);
    assert.match(fold, /VERDICT: CONTINUE/);
    assert.match(fold, /## Latest proposal\nnew proposal/);
    assert.doesNotMatch(fold, /old proposal/);
  });

  it("reviser turn folds latest proposal + latest critique + fresh human steering", () => {
    const fold = buildFold({
      role: "proposer",
      seed: "seed",
      turns: [
        turn("human", "stale steering (already folded earlier)"),
        turn("proposer", "the proposal"),
        turn("critic", "the critique"),
        turn("human", "prefer event sourcing"),
        turn("human", "drop the audit context"),
      ],
      round: 2,
      maxRounds: 4,
    });
    assert.match(fold, /## Latest proposal\nthe proposal/);
    assert.match(fold, /## Latest critique\nthe critique/);
    assert.match(fold, /## Human steering \(must be honored\)/);
    assert.match(fold, /- prefer event sourcing\n- drop the audit context/);
    assert.doesNotMatch(
      fold,
      /stale steering/,
      "steering before the last model turn is already folded — not repeated",
    );
  });

  it("is deterministic: same input → same fold", () => {
    const input = {
      role: "critic" as const,
      seed: "s",
      turns: [turn("proposer", "p")],
      round: 3,
      maxRounds: 4,
    };
    assert.strictEqual(buildFold(input), buildFold(input));
  });
});

describe("humanTurnsSinceLastModelTurn", () => {
  it("returns only human turns after the last proposer/critic turn, in order", () => {
    const result = humanTurnsSinceLastModelTurn([
      turn("human", "a"),
      turn("proposer", "p"),
      turn("human", "b"),
      turn("critic", "c"),
      turn("human", "d"),
      turn("system", "sys"),
      turn("human", "e"),
    ]);
    assert.deepStrictEqual(
      result.map((t) => t.content),
      ["d", "e"],
    );
  });

  it("ignores system turns and legacy role-less turns without breaking the scan", () => {
    const result = humanTurnsSinceLastModelTurn([
      turn("critic", "c"),
      turn(undefined, "legacy pasted turn"),
      turn("human", "steer"),
    ]);
    assert.deepStrictEqual(
      result.map((t) => t.content),
      ["steer"],
    );
  });

  it("empty when no model turn exists yet and no human turns", () => {
    assert.deepStrictEqual(humanTurnsSinceLastModelTurn([]), []);
  });
});
