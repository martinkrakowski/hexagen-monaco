import { describe, expect, test } from "vitest";
import { prePrReviewRefusal } from "../../src/internal/pre-pr.js";
import type { WaveEvent } from "../../src/internal/wave-types.js";

const event = (partial: {
  readonly wave: string;
  readonly lane: string;
  readonly stage: WaveEvent["stage"];
  readonly event: WaveEvent["event"];
  readonly detail?: WaveEvent["detail"];
}): WaveEvent => ({
  ts: "2026-09-29T10:00:00Z",
  ...partial,
});

describe("prePrReviewRefusal", () => {
  test("no stage=review event at all: refused, naming the missing event", () => {
    const events = [
      event({ wave: "w06", lane: "HX1", stage: "dispatch", event: "started" }),
    ];
    const refusal = prePrReviewRefusal(events, "w06", "HX1");
    expect(refusal).toContain("no stage=review event=settled");
    expect(refusal).toContain("HX1");
    expect(refusal).toContain("w06");
  });

  test("a review settled with a clear verdict: not refused", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "clear" },
      }),
    ];
    expect(prePrReviewRefusal(events, "w06", "HX1")).toBeUndefined();
  });

  test("a review settled with no verdict recorded at all: REFUSED — fail closed", () => {
    // The ordinary post-PR review bots emit stage=review event=settled with
    // only finding counts ({"bug":1,"suggestion":2,"nit":0}) and no verdict
    // at all. That must never satisfy D184's gate.
    const events = [
      event({ wave: "w06", lane: "HX1", stage: "review", event: "settled" }),
    ];
    const refusal = prePrReviewRefusal(events, "w06", "HX1");
    expect(refusal).toContain("no verdict recorded");
  });

  test("a review settled with an unrecognised verdict: refused, naming it", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "approved" },
      }),
    ];
    const refusal = prePrReviewRefusal(events, "w06", "HX1");
    expect(refusal).toContain("unrecognised verdict");
    expect(refusal).toContain("approved");
  });

  test("a review settled with the finding-count shape a review bot actually emits: refused", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { bug: 1, suggestion: 2, nit: 0 },
      }),
    ];
    const refusal = prePrReviewRefusal(events, "w06", "HX1");
    expect(refusal).toContain("no verdict recorded");
  });

  test("changes-required with no later remediate settled: refused", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "changes-required" },
      }),
    ];
    const refusal = prePrReviewRefusal(events, "w06", "HX1");
    expect(refusal).toContain("changes-required");
    expect(refusal).toContain("stage=remediate event=settled");
  });

  test("changes-required with a LATER remediate settled: not refused", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "changes-required" },
      }),
      event({ wave: "w06", lane: "HX1", stage: "remediate", event: "settled" }),
    ];
    expect(prePrReviewRefusal(events, "w06", "HX1")).toBeUndefined();
  });

  test("a remediate settled BEFORE the changes-required review does not count — order matters", () => {
    const events = [
      event({ wave: "w06", lane: "HX1", stage: "remediate", event: "settled" }),
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "changes-required" },
      }),
    ];
    const refusal = prePrReviewRefusal(events, "w06", "HX1");
    expect(refusal).toContain("no later stage=remediate event=settled");
  });

  test("a remediate settled for a different lane does not satisfy this lane's gate", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "changes-required" },
      }),
      event({ wave: "w06", lane: "HX5", stage: "remediate", event: "settled" }),
    ];
    expect(prePrReviewRefusal(events, "w06", "HX1")).toBeDefined();
  });

  test("the LATEST review settled governs — an earlier clear does not survive a later changes-required", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "clear" },
      }),
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "changes-required" },
      }),
    ];
    const refusal = prePrReviewRefusal(events, "w06", "HX1");
    expect(refusal).toContain("changes-required");
  });

  test("an earlier changes-required round, remediated, then reviewed clear again: not refused", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "changes-required" },
      }),
      event({ wave: "w06", lane: "HX1", stage: "remediate", event: "settled" }),
      event({
        wave: "w06",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "clear" },
      }),
    ];
    expect(prePrReviewRefusal(events, "w06", "HX1")).toBeUndefined();
  });

  test("a different lane's review settled does not satisfy this lane's gate", () => {
    const events = [
      event({
        wave: "w06",
        lane: "HX5",
        stage: "review",
        event: "settled",
        detail: { verdict: "clear" },
      }),
    ];
    expect(prePrReviewRefusal(events, "w06", "HX1")).toBeDefined();
  });

  test("a different wave's review settled does not satisfy this lane's gate", () => {
    const events = [
      event({
        wave: "w05",
        lane: "HX1",
        stage: "review",
        event: "settled",
        detail: { verdict: "clear" },
      }),
    ];
    expect(prePrReviewRefusal(events, "w06", "HX1")).toBeDefined();
  });

  test("a review that only started, never settled, does not satisfy the gate", () => {
    const events = [
      event({ wave: "w06", lane: "HX1", stage: "review", event: "started" }),
    ];
    expect(prePrReviewRefusal(events, "w06", "HX1")).toBeDefined();
  });
});
