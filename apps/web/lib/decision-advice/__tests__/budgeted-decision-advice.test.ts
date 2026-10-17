// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type {
  DecisionAdvicePort,
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "@hexagen/agentic-interaction";
import {
  createBudgetedDecisionAdvice,
  markDecisionCallRecorded,
  type DecisionSpendStore,
} from "../budgeted-decision-advice";

/**
 * Jev J5a1: the budgeted wrapper's five required behaviours (brief step 2):
 * under the cap passes; over the ceiling refuses; over the per-generation cap
 * refuses; concurrent asks cannot both pass the last slot; a store error
 * refuses — plus the callMaxMicroUsd default (1000).
 *
 * Jev J5a2 (review note B): the unrecorded-cost ledger — a sequential second
 * ask sees the first call's cost while its receipt is unrecorded, and after
 * markDecisionCallRecorded the cost is counted only through the store.
 *
 * The wrapper's module-level reservation total is back to zero after every
 * test here, because each ask settles its reservation before the test ends;
 * the unrecorded ledger is emptied by the afterEach below, because every
 * advised result parks its cost.
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

/** An advised result whose cost (25) parks in the ledger under `requestId`. */
function advisedWithCost(requestId: string): DecisionAdviceResult {
  return {
    status: "advised",
    answers: {},
    receipt: {
      use: "context-type",
      model: "typesafe/jev-1.14",
      requestId,
      generationId: "",
      status: "advised",
      costMicroUsd: 25,
      latencyMs: 200,
    },
  };
}

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

// Every parked ledger entry is removed after its test: a leftover would
// inflate the ceiling arithmetic of later tests (the ledger is exactly what
// the J5a2 tests below exercise, so it must start empty for each of them).
afterEach(() => {
  markDecisionCallRecorded("req-1");
  markDecisionCallRecorded("req-ledger-a");
  markDecisionCallRecorded("req-ledger-b");
});

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

  it("a sequential second ask sees the first call's cost while its receipt is unrecorded (J5a2)", async () => {
    // The store reads 0 (the receipt row has not landed) and the ceiling
    // holds exactly one callMax. The first ask settles with cost 25 parked
    // under "req-ledger-a"; without the ledger the second ask would project
    // 0 + 1000 ≤ 1000 and pass — with it, the parked 25 makes 1025 > 1000.
    const calls: DecisionAdviceRequest[] = [];
    const port: DecisionAdvicePort = {
      ask(request) {
        calls.push(request);
        return Promise.resolve(advisedWithCost("req-ledger-a"));
      },
    };
    const wrapper = createBudgetedDecisionAdvice({
      port,
      store: fakeStore(0),
      maxCalls: 20,
      ceilingMicroUsd: 1000,
      callMaxMicroUsd: 1000,
    });

    await expect(wrapper.ask(REQUEST)).resolves.toEqual(
      advisedWithCost("req-ledger-a"),
    );
    await expect(wrapper.ask(REQUEST)).resolves.toEqual(BUDGET_REFUSAL);
    expect(calls).toHaveLength(1);
  });

  it("after markDecisionCallRecorded the cost is counted only through the store (J5a2)", async () => {
    // First ask settles with cost 25 parked under "req-ledger-b"; a second
    // ask is refused while the cost sits in the ledger. Once the (simulated)
    // durable write lands — the store reads 25 and the entry is removed — a
    // fresh wrapper at a 1030 ceiling passes: 25 + 1000 = 1025 ≤ 1030. Had
    // the entry still counted, 25 + 25 + 1000 = 1050 would refuse: the cost
    // is counted exactly once, through the store read alone.
    const calls: DecisionAdviceRequest[] = [];
    const port: DecisionAdvicePort = {
      ask(request) {
        calls.push(request);
        return Promise.resolve(advisedWithCost("req-ledger-b"));
      },
    };
    const before = createBudgetedDecisionAdvice({
      port,
      store: fakeStore(0),
      maxCalls: 20,
      ceilingMicroUsd: 1000,
      callMaxMicroUsd: 1000,
    });
    await expect(before.ask(REQUEST)).resolves.toEqual(
      advisedWithCost("req-ledger-b"),
    );
    await expect(before.ask(REQUEST)).resolves.toEqual(BUDGET_REFUSAL);

    markDecisionCallRecorded("req-ledger-b");
    const after = createBudgetedDecisionAdvice({
      port,
      store: fakeStore(25),
      maxCalls: 20,
      ceilingMicroUsd: 1030,
      callMaxMicroUsd: 1000,
    });
    await expect(after.ask(REQUEST)).resolves.toEqual(
      advisedWithCost("req-ledger-b"),
    );
    expect(calls).toHaveLength(2);
  });
});
