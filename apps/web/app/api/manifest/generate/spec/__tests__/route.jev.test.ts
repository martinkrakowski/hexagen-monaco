// @vitest-environment node
/**
 * Jev J5a2 (brief step 4): the spec route's Jev wiring.
 *
 * The route's downstream collaborators are all mocked — the use case is a
 * class that only captures its constructor arguments, the wire.server
 * factories are stubs, and the platform store is a fake — so the suite
 * observes only what the route wires: no network, no database, no JWT
 * verification. The receipts store fake records what the injected sink wrote.
 */
import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import type {
  DecisionAdvicePort,
  DecisionReceipt,
} from "@hexagen/agentic-interaction";
// The REAL budgeted wrapper: the unrecorded-cost ledger is module state the
// sink's markDecisionCallRecorded interacts with (asserted below).
import {
  createBudgetedDecisionAdvice,
  markDecisionCallRecorded,
} from "../../../../../../lib/decision-advice/budgeted-decision-advice";

const tracker = vi.hoisted(() => {
  return {
    constructorArgs: [] as Array<Record<string, unknown>[]>,
    recordCall:
      vi.fn<(call: unknown, answers: unknown[]) => Promise<unknown>>(),
    spentSinceUtcMidnight: vi.fn<() => Promise<number>>(),
    createJevDecisionAdvice: vi.fn<() => unknown>(),
    getToken: vi.fn<() => Promise<{ sub?: string } | null>>(),
  };
});

vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => tracker.getToken(...(args as [])),
}));

vi.mock("../../../../../../lib/platform", () => ({
  getPlatformStore: () => ({
    decisionReceipts: {
      recordCall: tracker.recordCall,
      spentSinceUtcMidnight: tracker.spentSinceUtcMidnight,
    },
  }),
}));

vi.mock("@hexagen/agentic-interaction", async (importOriginal) => ({
  // The REAL pure domain (checkBudget etc.) — the budgeted wrapper's ledger
  // assertions below exercise it; only the use case is faked.
  ...(await importOriginal<typeof import("@hexagen/agentic-interaction")>()),
  ExecuteStructuredConfigGenerationUseCase: class {
    constructor(...args: unknown[]) {
      tracker.constructorArgs.push(args as Record<string, unknown>[]);
    }
    async execute() {
      return {
        success: true,
        value: { yaml: "x: y", parsedObject: {} },
        validation: { errors: [], warnings: [], passed: true },
        transactionId: "tx-1",
      };
    }
  },
  ClassifyContextTypeUseCase: class {},
  countManifestEntities: () => ({ adapterCount: 0 }),
  formatModelChip: () => null,
}));

vi.mock("../../../../../lib/wire.server", () => ({
  createGenerationTransactionManager: () => ({}),
  createJevDecisionAdvice: () => tracker.createJevDecisionAdvice(),
  createLLMProviderSelector: () => ({}),
  createStage6ReviewerConfig: () => null,
  createStage6ValidatorConfig: () => null,
}));

vi.mock("../../../../../../lib/request-guards", () => ({
  isSameOrigin: () => true,
}));

vi.mock("../../../../../../lib/rate-limiter", () => ({
  checkRateLimit: () => ({ allowed: true, retryAfter: 0 }),
}));

vi.mock("../../../../../../lib/enforce-quota", () => ({
  enforceDailyQuota: () => ({ ok: true, headers: {} }),
}));

const { POST } = await import("../route");

const JEVS: DecisionAdvicePort = {
  ask: () => Promise.resolve({ status: "unknown", reason: "disabled" }),
};

/** A fake config as `createJevDecisionAdvice` would return it. */
function jevConfig(overrides: Record<string, unknown> = {}) {
  return {
    port: JEVS,
    contextTypeMode: "shadow",
    minConfidence: 0.8,
    templateSuggest: false,
    reviewerSub: "reviewer-sub",
    ...overrides,
  };
}

/** A fake U-A receipt: two reviewed contexts, advised by Jev. */
function contextTypeReceipt(requestId: string) {
  const receipt: DecisionReceipt = {
    use: "context-type",
    model: "typesafe/jev-1.14",
    requestId,
    generationId: "gen-1",
    status: "advised",
    costMicroUsd: 25,
    latencyMs: 200,
  };
  return {
    generationId: "gen-1",
    mode: "shadow",
    receipt,
    answers: [
      {
        questionIndex: 0,
        jevAnswer: "core",
        jevConfidence: 0.9,
        todayAnswer: "core",
        todaySource: "llm",
        agreement: true,
      },
      {
        questionIndex: 1,
        jevAnswer: "supporting",
        jevConfidence: 0.7,
        todayAnswer: "generic",
        todaySource: "llm",
        agreement: false,
      },
    ],
  };
}

function post(): Promise<Response> {
  const request = new NextRequest(
    "http://localhost/api/manifest/generate/spec",
    {
      method: "POST",
      body: JSON.stringify({ config: JSON.stringify({ project: "acme" }) }),
      headers: { "Content-Type": "application/json" },
    },
  );
  return POST(request);
}

beforeEach(() => {
  tracker.constructorArgs.length = 0;
  tracker.recordCall.mockReset().mockResolvedValue({});
  tracker.spentSinceUtcMidnight.mockReset().mockResolvedValue(0);
  tracker.createJevDecisionAdvice.mockReset().mockReturnValue(null);
  tracker.getToken.mockReset().mockResolvedValue(null);
  // The sink's ledger bookkeeping must not leak between tests.
  markDecisionCallRecorded("req-jev-1");
});

test("with JEV_API_KEY unset the route passes no advice option and reads no JWT", async () => {
  const response = await post();
  await response.text();

  expect(tracker.createJevDecisionAdvice).toHaveBeenCalledTimes(1);
  expect(tracker.constructorArgs).toHaveLength(1);
  expect(tracker.constructorArgs[0]).toHaveLength(7);
  expect(tracker.constructorArgs[0][6]).toBeUndefined(); // no advice options
  expect(tracker.getToken).not.toHaveBeenCalled();
});

test("with the key and mode shadow the advice options are passed and the sink writes one call with N answers", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue(jevConfig());
  tracker.getToken.mockResolvedValue({ sub: "someone-else" });

  const response = await post();
  await response.text();

  const options = tracker.constructorArgs[0][6] as {
    decisionAdvice: DecisionAdvicePort;
    contextTypeMode: string;
    minConfidence: number;
    receiptSink: (receipt: unknown) => void;
  };
  expect(options.decisionAdvice).toBe(JEVS);
  expect(options.contextTypeMode).toBe("shadow");
  expect(options.minConfidence).toBe(0.8);

  // Park the advice call's cost in the unrecorded ledger first (as the
  // budgeted wrapper would when the real advice call settled): with the
  // entry in place, 25 (unrecorded) + 1000 (this call's max) exceeds the
  // 1000 ceiling, so an ask refuses — until the sink marks the call
  // recorded, which is observable as that ask now passing.
  const advisedReceipt = {
    use: "context-type",
    model: "",
    requestId: "req-jev-1",
    generationId: "",
    status: "advised" as const,
    costMicroUsd: 25,
    latencyMs: null,
  };
  const ledgerPort = {
    ask: () =>
      Promise.resolve({
        status: "advised" as const,
        answers: {},
        receipt: advisedReceipt,
      }),
  };
  const parking = createBudgetedDecisionAdvice({
    port: ledgerPort,
    store: { spentSinceUtcMidnight: () => Promise.resolve(0) },
    maxCalls: 20,
    ceilingMicroUsd: 1000,
    callMaxMicroUsd: 1000,
  });
  const ask = { use: "context-type", fields: [], questions: {} };
  await expect(parking.ask(ask)).resolves.toMatchObject({ status: "advised" });

  options.receiptSink(contextTypeReceipt("req-jev-1"));
  await vi.waitFor(() => expect(tracker.recordCall).toHaveBeenCalledTimes(1));
  const [call, answers] = tracker.recordCall.mock.calls[0] as [
    Record<string, unknown>,
    Record<string, unknown>[],
  ];
  expect(call).toMatchObject({
    use: "context-type",
    status: "advised",
    model: "typesafe/jev-1.14",
    requestId: "req-jev-1",
    generationId: "gen-1",
    costMicroUsd: 25,
    latencyMs: 200,
  });
  // One answer row per reviewed context, each closed-set.
  expect(answers).toHaveLength(2);
  expect(answers[0]).toEqual({
    questionIndex: 0,
    mode: "shadow",
    jevAnswer: "core",
    jevConfidence: 0.9,
    todayAnswer: "core",
    todaySource: "llm",
    agreement: true,
  });
  expect(answers[1]).toMatchObject({
    questionIndex: 1,
    jevAnswer: "supporting",
    todayAnswer: "generic",
    agreement: false,
  });

  // The sink removed the parked ledger entry after the write resolved.
  await vi.waitFor(() => {
    // The entry is gone: with the store still reading 0, a fresh ask fits the
    // 1000 ceiling — markDecisionCallRecorded ran after the write resolved.
    const ledger = createBudgetedDecisionAdvice({
      port: ledgerPort,
      store: { spentSinceUtcMidnight: () => Promise.resolve(0) },
      maxCalls: 20,
      ceilingMicroUsd: 1000,
      callMaxMicroUsd: 1000,
    });
    return expect(ledger.ask(ask)).resolves.toMatchObject({
      status: "advised",
    });
  });
  markDecisionCallRecorded("req-jev-1");
});

test("reviewer is true only when the token sub equals JEV_REVIEWER_SUB", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue(jevConfig());
  tracker.getToken.mockResolvedValue({ sub: "reviewer-sub" });

  const response = await post();
  await response.text();
  const options = tracker.constructorArgs[0][6] as {
    receiptSink: (receipt: unknown) => void;
  };
  options.receiptSink(contextTypeReceipt("req-jev-1"));
  await vi.waitFor(() => expect(tracker.recordCall).toHaveBeenCalledTimes(1));
  expect(
    (tracker.recordCall.mock.calls[0][0] as { reviewer: boolean }).reviewer,
  ).toBe(true);
});

test("a sub that differs (or a reviewerSub that is empty) records reviewer false", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue(
    jevConfig({ reviewerSub: "" }),
  );
  tracker.getToken.mockResolvedValue({ sub: "reviewer-sub" });

  const response = await post();
  await response.text();
  const options = tracker.constructorArgs[0][6] as {
    receiptSink: (receipt: unknown) => void;
  };
  options.receiptSink(contextTypeReceipt("req-jev-1"));
  await vi.waitFor(() => expect(tracker.recordCall).toHaveBeenCalledTimes(1));
  expect(
    (tracker.recordCall.mock.calls[0][0] as { reviewer: boolean }).reviewer,
  ).toBe(false);
});

test("a sub that differs from JEV_REVIEWER_SUB records reviewer false", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue(jevConfig());
  tracker.getToken.mockResolvedValue({ sub: "not-the-reviewer" });

  const response = await post();
  await response.text();
  const options = tracker.constructorArgs[0][6] as {
    receiptSink: (receipt: unknown) => void;
  };
  options.receiptSink(contextTypeReceipt("req-jev-1"));
  await vi.waitFor(() => expect(tracker.recordCall).toHaveBeenCalledTimes(1));
  expect(
    (tracker.recordCall.mock.calls[0][0] as { reviewer: boolean }).reviewer,
  ).toBe(false);
});

test("a throwing store never fails the generation", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue(jevConfig());
  tracker.getToken.mockResolvedValue({ sub: "reviewer-sub" });
  tracker.recordCall.mockRejectedValue(new Error("db unavailable"));

  const response = await post();
  const body = await response.text();

  const options = tracker.constructorArgs[0][6] as {
    receiptSink: (receipt: unknown) => void;
  };
  options.receiptSink(contextTypeReceipt("req-jev-1"));
  await vi.waitFor(() => expect(tracker.recordCall).toHaveBeenCalledTimes(1));

  const events = body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string });
  expect(events.at(-1)?.type).toBe("done");
});
