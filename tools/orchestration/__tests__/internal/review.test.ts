import { describe, test, expect } from "vitest";
import { governingPlanReview } from "../../src/internal/review.js";
import type { WaveEvent } from "../../src/internal/wave-types.js";

const review = (over: Partial<WaveEvent> = {}): WaveEvent => ({
  ts: "2026-09-28T10:00:00Z",
  wave: "W",
  lane: "_plan",
  stage: "plan-review",
  event: "settled",
  detail: {
    plan: "docs/planning/p.md",
    rows: { L5a: "aa" },
    verdict: "clear",
  },
  ...over,
});

describe("governingPlanReview — the gate's one rule, run by both of its faces", () => {
  test("the latest settled review for the wave wins", () => {
    const events = [
      review({ ts: "2026-09-28T09:00:00Z" }),
      review({ ts: "2026-09-28T10:00:00Z" }),
    ];
    expect(governingPlanReview(events, "W")?.index).toBe(1);
  });

  test("another wave's, another lane's, or another stage's events never govern", () => {
    const events = [
      review({ wave: "OTHER" }),
      review({ lane: "L5a" }),
      review({ event: "started" }),
      review({ stage: "dispatch" }),
      review(),
    ];
    const found = governingPlanReview(events, "W");
    expect(found?.index).toBe(4);
    expect(found?.event.detail?.verdict).toBe("clear");
  });

  test("a review at or after `before` in log order governs nothing behind it", () => {
    const events = [review(), review({ ts: "2026-09-28T11:00:00Z" })];
    expect(governingPlanReview(events, "W", 1)?.index).toBe(0);
    expect(governingPlanReview(events, "W", 0)).toBeUndefined();
    // A cutoff past the end is the whole log, not a silence.
    expect(governingPlanReview(events, "W", 99)?.index).toBe(1);
  });

  test("the plan the review names travels with it; a missing or empty plan is none", () => {
    expect(governingPlanReview([review()], "W")?.plan).toBe(
      "docs/planning/p.md",
    );
    expect(
      governingPlanReview(
        [review({ detail: { rows: {}, verdict: "clear" } })],
        "W",
      )?.plan,
    ).toBeUndefined();
    expect(
      governingPlanReview(
        [review({ detail: { plan: "", rows: {}, verdict: "clear" } })],
        "W",
      )?.plan,
    ).toBeUndefined();
  });

  test("no settled review for the wave is no review", () => {
    expect(governingPlanReview([], "W")).toBeUndefined();
    expect(
      governingPlanReview([review({ wave: "OTHER" })], "W"),
    ).toBeUndefined();
  });
});
