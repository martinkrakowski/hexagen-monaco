// @vitest-environment node
import { describe, it, expect } from "vitest";
import type {
  DecisionAdvicePort,
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "@hexagen/agentic-interaction";
import {
  createBudgetedDecisionAdvice,
  type DecisionSpendStore,
} from "../budgeted-decision-advice";

/**
 * Jev J5a1: the budgeted wrapper's five required behaviours (brief step 2):
 * under the cap passes; over the ceiling refuses; over the per-generation cap
 * refuses; concurrent asks cannot both pass the last slot; a store error
 * refuses — plus the callMaxMicroUsd default (1000).
 *
 * The wrapper's module-level reservation total is back to zero after every
 * test here, because each ask settles its reservation before the test ends.
 */

const REQUEST: DecisionAdviceRequest = {
  use: "context-type",
  fields: [{ name: "project", value: "acme" }],
  questions: {
    c0: {
      type: "choice",
      instructions: "pick the context type",
      criteria: { core: "c", supporting: "s" },
    },
  },
};

const ADVISED: DecisionAdviceResult = {
  status: "advised",
  answers: {},
  receipt: {
    use: "context-type",
    model: "typesafe/jev-1.14",
    requestId: "req-1",
    generationId: "",
    status: "advised",
    costMicroUsd: 25,
    latencyMs: 200,
  },
};

const BUDGET_REFUSAL: DecisionAdviceResult = {
  status: "unknown",
  reason: "budget",
};

function fakePort(): {
  port: DecisionAdvicePort;
  calls: DecisionAdviceRequest[];
} {
  const calls: DecisionAdviceRequest[] = [];
  return {
    calls,
    port: {
      ask(request) {
        calls.push(request);
        return Promise.resolve(ADVISED);
      },
    },
  };
}

function fakeStore(spentTodayMicroUsd: number): DecisionSpendStore {
  return {
    spentSinceUtcMidnight: () => Promise.resolve(spentTodayMicroUsd),
  };
}

function failingStore(): DecisionSpendStore {
  return {
    spentSinceUtcMidnight: () =>
      Promise.reject(new Error("ceiling ledger unreadable")),
  };
}

describe("createBudgetedDecisionAdvice", () => {
  it("under both caps the inner port is called and its result passes through unchanged", async () => {
    const { port, calls } = fakePort();
    const wrapper = createBudgetedDecisionAdvice({
      port,
      store: fakeStore(0),
      maxCalls: 20,
      ceilingMicroUsd: 500_000,
      callMaxMicroUsd: 1000,
    });

    await expect(wrapper.ask(REQUEST)).resolves.toEqual(ADVISED);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(REQUEST);
  });

  it("over the daily ceiling the call is refused as unknown/budget and the port is never called", async () => {
    const { port, calls } = fakePort();
    const wrapper = createBudgetedDecisionAdvice({
      port,
      // 499_500 already spent + 1000 reserved for this call = 500_500 > 500_000.
      store: fakeStore(499_500),
      maxCalls: 20,
      ceilingMicroUsd: 500_000,
      callMaxMicroUsd: 1000,
    });

    await expect(wrapper.ask(REQUEST)).resolves.toEqual(BUDGET_REFUSAL);
    expect(calls).toHaveLength(0);
  });

  it("over the per-generation call cap the next ask refuses", async () => {
    const { port, calls } = fakePort();
    const wrapper = createBudgetedDecisionAdvice({
      port,
      store: fakeStore(0),
      maxCalls: 1,
      ceilingMicroUsd: 500_000,
      callMaxMicroUsd: 1000,
    });

    await expect(wrapper.ask(REQUEST)).resolves.toEqual(ADVISED);
    await expect(wrapper.ask(REQUEST)).resolves.toEqual(BUDGET_REFUSAL);
    expect(calls).toHaveLength(1);
  });

  it("two concurrent asks cannot both pass the last slot under the ceiling", async () => {
    // The ceiling holds exactly one callMax: the first ask's reservation must
    // make the second ask's check fail while the first call is still in
    // flight — the reservation is what the mutex protects.
    let release!: (result: DecisionAdviceResult) => void;
    const calls: DecisionAdviceRequest[] = [];
    const port: DecisionAdvicePort = {
      ask(request) {
        calls.push(request);
        return new Promise<DecisionAdviceResult>((resolve) => {
          release = resolve;
        });
      },
    };
    const wrapper = createBudgetedDecisionAdvice({
      port,
      store: fakeStore(0),
      maxCalls: 20,
      ceilingMicroUsd: 1000,
      callMaxMicroUsd: 1000,
    });

    const first = wrapper.ask(REQUEST);
    const second = wrapper.ask(REQUEST);

    await expect(second).resolves.toEqual(BUDGET_REFUSAL);
    expect(calls).toHaveLength(1);

    release(ADVISED);
    await expect(first).resolves.toEqual(ADVISED);
  });

  it("a store error refuses the call (fail closed)", async () => {
    const { port, calls } = fakePort();
    const wrapper = createBudgetedDecisionAdvice({
      port,
      store: failingStore(),
      maxCalls: 20,
      ceilingMicroUsd: 500_000,
      callMaxMicroUsd: 1000,
    });

    await expect(wrapper.ask(REQUEST)).resolves.toEqual(BUDGET_REFUSAL);
    expect(calls).toHaveLength(0);
  });

  it("callMaxMicroUsd defaults to 1000 micro-USD", async () => {
    const { port, calls } = fakePort();
    // With the default, one call projects exactly 1000: allowed at a 1000
    // ceiling, refused at 999. A smaller default would pass the 999 case.
    const atTheDefault = createBudgetedDecisionAdvice({
      port,
      store: fakeStore(0),
      maxCalls: 20,
      ceilingMicroUsd: 1000,
    });
    const underTheDefault = createBudgetedDecisionAdvice({
      port,
      store: fakeStore(0),
      maxCalls: 20,
      ceilingMicroUsd: 999,
    });

    await expect(atTheDefault.ask(REQUEST)).resolves.toEqual(ADVISED);
    await expect(underTheDefault.ask(REQUEST)).resolves.toEqual(BUDGET_REFUSAL);
    expect(calls).toHaveLength(1);
  });
});
