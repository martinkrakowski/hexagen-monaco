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

describe("parseChoiceAnswer rejects bad shapes as unknown/shape", () => {
  it("rejects an unknown key in probabilities", () => {
    const raw = {
      type: "choice",
      choice: "core",
      probabilities: { core: 1, extra: 0 },
      confidence: 1,
    };
    expect(parseChoiceAnswer(raw, ["core"])).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("rejects a missing option in probabilities", () => {
    const raw = {
      type: "choice",
      choice: "core",
      probabilities: { core: 1, supporting: 0, generic: 0, "shared-kernel": 0 },
      confidence: 1,
    };
    expect(parseChoiceAnswer(raw, FIVE_TYPES)).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("rejects a non-finite number", () => {
    const raw = {
      type: "choice",
      choice: "core",
      probabilities: {
        core: Number.NaN,
        supporting: 0,
        generic: 0,
        "shared-kernel": 0,
        driver: 0,
      },
      confidence: 1,
    };
    expect(parseChoiceAnswer(raw, FIVE_TYPES)).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("rejects a number outside 0..1", () => {
    const raw = {
      type: "choice",
      choice: "core",
      probabilities: {
        core: 1.5,
        supporting: 0,
        generic: 0,
        "shared-kernel": 0,
        driver: 0,
      },
      confidence: 1,
    };
    expect(parseChoiceAnswer(raw, FIVE_TYPES)).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("rejects a confidence outside 0..1", () => {
    const raw = {
      type: "choice",
      choice: "core",
      probabilities: {
        core: 1,
        supporting: 0,
        generic: 0,
        "shared-kernel": 0,
        driver: 0,
      },
      confidence: -0.1,
    };
    expect(parseChoiceAnswer(raw, FIVE_TYPES)).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("rejects a choice that is not the argmax", () => {
    const raw = {
      type: "choice",
      choice: "generic",
      probabilities: {
        core: 1,
        supporting: 0,
        generic: 0,
        "shared-kernel": 0,
        driver: 0,
      },
      confidence: 1,
    };
    expect(parseChoiceAnswer(raw, FIVE_TYPES)).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("rejects a choice that is not a declared option id", () => {
    const raw = {
      type: "choice",
      choice: "edge",
      probabilities: {
        core: 1,
        supporting: 0,
        generic: 0,
        "shared-kernel": 0,
        driver: 0,
      },
      confidence: 1,
    };
    expect(parseChoiceAnswer(raw, FIVE_TYPES)).toEqual({
      ok: false,
      reason: "shape",
    });
  });

  it("rejects a non-object, a wrong type tag and a non-string choice", () => {
    expect(parseChoiceAnswer(null, FIVE_TYPES)).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(parseChoiceAnswer([1], FIVE_TYPES)).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(
      parseChoiceAnswer({ type: "noul", probability: 0.5 }, FIVE_TYPES),
    ).toEqual({
      ok: false,
      reason: "shape",
    });
    expect(
      parseChoiceAnswer(
        { type: "choice", choice: 1, probabilities: {}, confidence: 1 },
        FIVE_TYPES,
      ),
    ).toEqual({ ok: false, reason: "shape" });
  });
});

describe("parseChoiceAnswer tie handling", () => {
  it("rejects a tie for the maximum as unknown/tie", () => {
    const raw = {
      type: "choice",
      choice: "core",
      probabilities: {
        core: 0.5,
        supporting: 0.5,
        generic: 0,
        "shared-kernel": 0,
        driver: 0,
      },
      confidence: 0.5,
    };
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
