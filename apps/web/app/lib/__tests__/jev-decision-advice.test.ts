/**
 * Jev J5a1: `createJevDecisionAdvice` — the dedicated-key gate (invariant 1)
 * and the JEV_* knob parsing. The adapter, the budgeted wrapper and the
 * platform store are all mocks, so the suite observes only what the factory
 * wires together: no network, no database, no key material in flight.
 *
 * The key is asserted by PRESENCE only, plus one negative assertion that a
 * sentinel value never reaches the returned config — the factory must never
 * print, log or carry it.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const JEV_ENV_VARS = [
  "JEV_API_KEY",
  "JEV_CONTEXT_TYPE_MODE",
  "JEV_CONTEXT_TYPE_MIN_CONFIDENCE",
  "JEV_MAX_CALLS_PER_GENERATION",
  "JEV_DAILY_COST_CEILING_USD",
  "JEV_TEMPLATE_SUGGEST",
  "JEV_REVIEWER_SUB",
] as const;

const tracker = vi.hoisted(() => {
  const decisionReceipts = { __sentinel: "platform-store.decisionReceipts" };
  return {
    decisionReceipts,
    adapterInstances: [] as unknown[],
    wrapperOptions: [] as Array<Record<string, unknown>>,
  };
});

vi.mock("@hexagen/agentic-interaction/server", () => ({
  JevDecisionAdapter: class {
    constructor(_options: unknown) {
      // The instance the factory built — what the wrapper must wrap.
      tracker.adapterInstances.push(this);
    }
  },
}));

vi.mock("../../../lib/decision-advice/budgeted-decision-advice", () => ({
  createBudgetedDecisionAdvice: (options: Record<string, unknown>) => {
    tracker.wrapperOptions.push(options);
    return { __sentinel: "budgeted-decision-advice" };
  },
}));

vi.mock("../../../lib/platform/store", () => ({
  getPlatformStore: () => ({ decisionReceipts: tracker.decisionReceipts }),
}));

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const name of JEV_ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  tracker.adapterInstances.length = 0;
  tracker.wrapperOptions.length = 0;
});

afterEach(() => {
  for (const name of JEV_ENV_VARS) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.resetModules();
});

async function loadFactory() {
  const { createJevDecisionAdvice } = await import("../wire.server");
  return createJevDecisionAdvice;
}

test.each([undefined, "", "   "])(
  "JEV_API_KEY %p (unset/blank) → null, nothing constructed",
  async (key) => {
    if (key !== undefined) process.env.JEV_API_KEY = key;
    const createJevDecisionAdvice = await loadFactory();
    expect(createJevDecisionAdvice()).toBeNull();
    expect(tracker.adapterInstances).toHaveLength(0);
    expect(tracker.wrapperOptions).toHaveLength(0);
  },
);

test("with the key set: default knobs, the budgeted wrapper around the one adapter, and the receipts store wired", async () => {
  process.env.JEV_API_KEY = "sk-jev-test-sentinel";
  const createJevDecisionAdvice = await loadFactory();

  const config = createJevDecisionAdvice();
  expect(config).not.toBeNull();
  expect(config?.contextTypeMode).toBe("off");
  expect(config?.minConfidence).toBe(0.8);
  expect(config?.templateSuggest).toBe(false);
  expect(config?.reviewerSub).toBe("");

  // The port IS the budgeted wrapper's return value; the wrapper wraps the
  // one adapter instance and reads the platform store's receipts store.
  expect(config?.port).toEqual({ __sentinel: "budgeted-decision-advice" });
  expect(tracker.adapterInstances).toHaveLength(1);
  expect(tracker.wrapperOptions).toHaveLength(1);
  const wrapperOptions = tracker.wrapperOptions[0] as {
    port: unknown;
    store: unknown;
    maxCalls: number;
    ceilingMicroUsd: number;
  };
  expect(wrapperOptions.port).toBe(tracker.adapterInstances[0]);
  expect(wrapperOptions.store).toBe(tracker.decisionReceipts);
  expect(wrapperOptions.maxCalls).toBe(20);
  expect(wrapperOptions.ceilingMicroUsd).toBe(500_000);

  // Never print or log the key: it must not ride on the returned config.
  expect(JSON.stringify(config)).not.toContain("sk-jev-test-sentinel");
});

test.each([
  ["shadow", "shadow"],
  ["primary", "primary"],
  ["off", "off"],
  ["banana", "off"],
  ["", "off"],
  [undefined, "off"],
])("JEV_CONTEXT_TYPE_MODE %p → %p", async (raw, expected) => {
  process.env.JEV_API_KEY = "set";
  if (raw !== undefined) process.env.JEV_CONTEXT_TYPE_MODE = raw;
  const createJevDecisionAdvice = await loadFactory();
  expect(createJevDecisionAdvice()?.contextTypeMode).toBe(expected);
});

test.each([
  ["0.9", 0.9],
  ["0", 0],
  ["1", 1],
  ["1.7", 1], // clamped up to 1
  ["-0.4", 0.8], // negative is malformed → default, never 0
  ["abc", 0.8], // malformed → default, never NaN
  ["NaN", 0.8], // the literal NaN string → default
  ["", 0.8], // deploy.yml writes unset vars as empty
  [undefined, 0.8],
])("JEV_CONTEXT_TYPE_MIN_CONFIDENCE %p → %p", async (raw, expected) => {
  process.env.JEV_API_KEY = "set";
  if (raw !== undefined) process.env.JEV_CONTEXT_TYPE_MIN_CONFIDENCE = raw;
  const createJevDecisionAdvice = await loadFactory();
  expect(createJevDecisionAdvice()?.minConfidence).toBe(expected);
});

test.each([
  ["5", 5],
  ["abc", 20],
  ["NaN", 20],
  ["", 20],
  [undefined, 20],
])(
  "JEV_MAX_CALLS_PER_GENERATION %p → wrapper maxCalls %p",
  async (raw, expected) => {
    process.env.JEV_API_KEY = "set";
    if (raw !== undefined) process.env.JEV_MAX_CALLS_PER_GENERATION = raw;
    const createJevDecisionAdvice = await loadFactory();
    createJevDecisionAdvice();
    expect(tracker.wrapperOptions).toHaveLength(1);
    expect((tracker.wrapperOptions[0] as { maxCalls: number }).maxCalls).toBe(
      expected,
    );
  },
);

test.each([
  ["2", 2_000_000],
  ["0.50", 500_000],
  ["abc", 500_000],
  ["", 500_000],
  [undefined, 500_000],
])(
  "JEV_DAILY_COST_CEILING_USD %p → wrapper ceilingMicroUsd %p",
  async (raw, expected) => {
    process.env.JEV_API_KEY = "set";
    if (raw !== undefined) process.env.JEV_DAILY_COST_CEILING_USD = raw;
    const createJevDecisionAdvice = await loadFactory();
    createJevDecisionAdvice();
    expect(tracker.wrapperOptions).toHaveLength(1);
    expect(
      (tracker.wrapperOptions[0] as { ceilingMicroUsd: number })
        .ceilingMicroUsd,
    ).toBe(expected);
  },
);

test.each([
  ["on", true],
  ["off", false],
  ["banana", false],
  ["", false],
  [undefined, false],
])("JEV_TEMPLATE_SUGGEST %p → %p", async (raw, expected) => {
  process.env.JEV_API_KEY = "set";
  if (raw !== undefined) process.env.JEV_TEMPLATE_SUGGEST = raw;
  const createJevDecisionAdvice = await loadFactory();
  expect(createJevDecisionAdvice()?.templateSuggest).toBe(expected);
});

test.each([
  ["auth0|12345", "auth0|12345"],
  ["", ""],
  [undefined, ""],
])(
  "JEV_REVIEWER_SUB %p → %p (a string, may be empty)",
  async (raw, expected) => {
    process.env.JEV_API_KEY = "set";
    if (raw !== undefined) process.env.JEV_REVIEWER_SUB = raw;
    const createJevDecisionAdvice = await loadFactory();
    expect(createJevDecisionAdvice()?.reviewerSub).toBe(expected);
  },
);
