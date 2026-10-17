import { describe, expect, it } from "vitest";
import { checkBudget } from "../../src/domain/decision-advice";

const BASE = {
  callsThisGeneration: 0,
  maxCalls: 20,
  spentTodayMicroUsd: 0,
  reservedMicroUsd: 0,
  ceilingMicroUsd: 500_000, // 0.50 USD in micro-USD
  callMaxMicroUsd: 100,
};

describe("checkBudget call cap", () => {
  it("allows when under the call cap", () => {
    expect(checkBudget({ ...BASE, callsThisGeneration: 19 })).toEqual({ allowed: true });
  });

  it("refuses at the call cap boundary (the 21st call)", () => {
    expect(checkBudget({ ...BASE, callsThisGeneration: 20 })).toEqual({
      allowed: false,
      reason: "budget",
    });
  });

  it("refuses beyond the call cap", () => {
    expect(checkBudget({ ...BASE, callsThisGeneration: 25 })).toEqual({
      allowed: false,
      reason: "budget",
    });
  });

  it("allows the very first call", () => {
    expect(checkBudget(BASE)).toEqual({ allowed: true });
  });
});

describe("checkBudget daily cost ceiling", () => {
  it("allows when projected spend is exactly at the ceiling", () => {
    expect(
      checkBudget({
        ...BASE,
        spentTodayMicroUsd: 499_900,
        reservedMicroUsd: 0,
        callMaxMicroUsd: 100,
      }),
    ).toEqual({ allowed: true });
  });

  it("refuses when spent plus reserved plus this call exceeds the ceiling by one micro", () => {
    expect(
      checkBudget({
        ...BASE,
        spentTodayMicroUsd: 499_900,
        reservedMicroUsd: 0,
        callMaxMicroUsd: 101,
      }),
    ).toEqual({ allowed: false, reason: "budget" });
  });

  it("refuses when spent alone has already reached the ceiling", () => {
    expect(checkBudget({ ...BASE, spentTodayMicroUsd: 500_000 })).toEqual({
      allowed: false,
      reason: "budget",
    });
  });

  it("refuses when the in-process reservation pushes the projection over", () => {
    expect(
      checkBudget({
        ...BASE,
        spentTodayMicroUsd: 400_000,
        reservedMicroUsd: 99_950,
        callMaxMicroUsd: 100,
      }),
    ).toEqual({ allowed: false, reason: "budget" });
  });

  it("allows when spent plus reservation leaves room for this call's max", () => {
    expect(
      checkBudget({
        ...BASE,
        spentTodayMicroUsd: 400_000,
        reservedMicroUsd: 99_900,
        callMaxMicroUsd: 100,
      }),
    ).toEqual({ allowed: true });
  });
});