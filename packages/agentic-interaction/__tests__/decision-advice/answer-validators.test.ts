import { describe, expect, it } from "vitest";
import {
  parseChoiceAnswer,
  parseNoulAnswer,
} from "../../src/domain/decision-advice";
import contextTypeResponse from "../use-cases/staged-generation/fixtures/jev/jev-context-type-response.json";
import templateSelectResponse from "../use-cases/staged-generation/fixtures/jev/jev-template-select-response.json";

const FIVE_TYPES = ["core", "supporting", "generic", "shared-kernel", "driver"];

describe("parseChoiceAnswer against the committed fixture responses", () => {
  it("accepts the c0 answer (certain core)", () => {
    const raw = contextTypeResponse.answers.c0;
    const result = parseChoiceAnswer(raw, FIVE_TYPES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.choice).toBe("core");
      expect(result.answer.confidence).toBe(1);
    }
  });

  it("accepts the c1 answer (supporting, single argmax)", () => {
    const result = parseChoiceAnswer(
      contextTypeResponse.answers.c1,
      FIVE_TYPES,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.choice).toBe("supporting");
      expect(result.answer.probabilities).toEqual(
        contextTypeResponse.answers.c1.probabilities,
      );
    }
  });

  it("accepts the template-select q0 answer over string option ids", () => {
    const result = parseChoiceAnswer(templateSelectResponse.answers.q0, [
      "0",
      "1",
      "2",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.choice).toBe("0");
      expect(result.answer.probabilities["0"]).toBe(0.59);
    }
  });
});

const CERTAIN_CORE = {
  core: 1,
  supporting: 0,
  generic: 0,
  "shared-kernel": 0,
  driver: 0,
};

/** A well-formed `core` answer over the five types, with some fields changed. */
function choiceWith(changes: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "choice",
    choice: "core",
    probabilities: CERTAIN_CORE,
    confidence: 1,
    ...changes,
  };
}

const SHAPE = { ok: false, reason: "shape" };

describe("parseChoiceAnswer rejects bad shapes as unknown/shape", () => {
  it.each<[string, unknown, readonly string[]]>([
    [
      "an unknown key in probabilities",
      choiceWith({ probabilities: { core: 1, extra: 0 } }),
      ["core"],
    ],
    [
      "a missing option in probabilities",
      choiceWith({
        probabilities: {
          core: 1,
          supporting: 0,
          generic: 0,
          "shared-kernel": 0,
        },
      }),
      FIVE_TYPES,
    ],
    [
      "a non-finite number",
      choiceWith({ probabilities: { ...CERTAIN_CORE, core: Number.NaN } }),
      FIVE_TYPES,
    ],
    [
      "a number outside 0..1",
      choiceWith({ probabilities: { ...CERTAIN_CORE, core: 1.5 } }),
      FIVE_TYPES,
    ],
    ["a confidence outside 0..1", choiceWith({ confidence: -0.1 }), FIVE_TYPES],
    [
      "a choice that is not the argmax",
      choiceWith({ choice: "generic" }),
      FIVE_TYPES,
    ],
    [
      "a choice that is not a declared option id",
      choiceWith({ choice: "edge" }),
      FIVE_TYPES,
    ],
    ["a non-object", null, FIVE_TYPES],
    ["an array", [1], FIVE_TYPES],
    ["a wrong type tag", { type: "noul", probability: 0.5 }, FIVE_TYPES],
    [
      "a non-string choice",
      choiceWith({ choice: 1, probabilities: {} }),
      FIVE_TYPES,
    ],
  ])("rejects %s", (_label, raw, options) => {
    expect(parseChoiceAnswer(raw, options)).toEqual(SHAPE);
  });
});

describe("parseChoiceAnswer tie handling", () => {
  it("rejects a tie for the maximum as unknown/tie", () => {
    const raw = choiceWith({
      probabilities: { ...CERTAIN_CORE, core: 0.5, supporting: 0.5 },
      confidence: 0.5,
    });
    expect(parseChoiceAnswer(raw, FIVE_TYPES)).toEqual({
      ok: false,
      reason: "tie",
    });
  });
});

describe("parseNoulAnswer", () => {
  it("returns a probability with confidence max(p, 1−p)", () => {
    const result = parseNoulAnswer({ type: "noul", probability: 0.7 });
    expect(result).toEqual({
      ok: true,
      answer: { type: "noul", probability: 0.7, confidence: 0.7 },
    });
  });

  it("derives confidence above one half from the complement", () => {
    const result = parseNoulAnswer({ type: "noul", probability: 0.2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.confidence).toBe(0.8);
    }
  });

  it("accepts the boundaries 0 and 1", () => {
    expect(parseNoulAnswer({ type: "noul", probability: 0 })).toEqual({
      ok: true,
      answer: { type: "noul", probability: 0, confidence: 1 },
    });
    expect(parseNoulAnswer({ type: "noul", probability: 1 })).toEqual({
      ok: true,
      answer: { type: "noul", probability: 1, confidence: 1 },
    });
  });

  it("rejects bad shapes", () => {
    expect(parseNoulAnswer(null)).toEqual({ ok: false, reason: "shape" });
    expect(parseNoulAnswer({ type: "choice" })).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(parseNoulAnswer({ type: "noul", probability: 1.2 })).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(
      parseNoulAnswer({ type: "noul", probability: Number.POSITIVE_INFINITY }),
    ).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(parseNoulAnswer({ type: "noul" })).toEqual({
      ok: false,
      reason: "shape",
    });
  });
});
