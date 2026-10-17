// @vitest-environment node
/**
 * Jev J5b: /api/jev/report behind the reviewer gate.
 *
 * The gate is exercised through the route with `next-auth/jwt` and
 * `wire.server` mocked exactly as spec/__tests__/route.jev.test.ts does (the
 * mock paths resolve to the modules the route actually imports). The store
 * underneath is the REAL decision-receipts store on the shared test backends,
 * seeded per case, so the report's shape is asserted against real counts.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DecisionReceiptsStore } from "../../../../../lib/platform/decision-receipts-store";

const tracker = vi.hoisted(() => {
  return {
    // Swapped per test: a fake store (gate cases) or the real seeded store.
    getStore: vi.fn<() => { decisionReceipts: unknown }>(),
    createJevDecisionAdvice: vi.fn<() => unknown>(),
    getToken: vi.fn<() => Promise<{ sub?: string } | null>>(),
  };
});

vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => tracker.getToken(...(args as [])),
}));

vi.mock("../../../../../lib/platform", () => ({
  getPlatformStore: () => tracker.getStore(),
}));

vi.mock("../../../../../app/lib/wire.server", () => ({
  createJevDecisionAdvice: () => tracker.createJevDecisionAdvice(),
}));

const { GET } = await import("../route");

const REVIEWER_SUB = "reviewer-sub";

function get(): Promise<Response> {
  const request = new NextRequest("http://localhost/api/jev/report");
  return GET(request);
}

/** The real store on a sqlite backend, seeded with a small shadow cohort. */
async function seededStore(): Promise<{
  store: DecisionReceiptsStore;
  close: () => Promise<void>;
}> {
  const { openBackend } =
    await import("../../../../../test-support/platform-backends");
  const { createDecisionReceiptsStore } =
    await import("../../../../../lib/platform/decision-receipts-store");
  const backend = await openBackend("sqlite");
  const store = createDecisionReceiptsStore(backend.db);
  return { store, close: () => backend.close() };
}

beforeEach(() => {
  tracker.createJevDecisionAdvice.mockReset().mockReturnValue(null);
  tracker.getToken.mockReset().mockResolvedValue(null);
  tracker.getStore.mockReset();
  delete process.env.JEV_REVIEWER_SUB;
});

afterEach(() => {
  delete process.env.JEV_REVIEWER_SUB;
});

test("404 with no reviewerSub configured", async () => {
  const response = await get();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  // The gate answers before the store is touched.
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test("404 with a different sub", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue({
    reviewerSub: REVIEWER_SUB,
  });
  tracker.getToken.mockResolvedValue({ sub: "someone-else" });
  const response = await get();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test("404 when getToken throws", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue({
    reviewerSub: REVIEWER_SUB,
  });
  tracker.getToken.mockRejectedValue(new Error("bad token"));
  const response = await get();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test("404 when the env fallback alone is set but the token differs", async () => {
  // The config path (no JEV_API_KEY -> null) falls back to the env read,
  // the way wire.server itself reads it.
  process.env.JEV_REVIEWER_SUB = REVIEWER_SUB;
  tracker.getToken.mockResolvedValue({ sub: "someone-else" });
  expect((await get()).status).toBe(404);
});

test("the report's shape on a seeded sqlite store, floors met", async () => {
  const { store, close } = await seededStore();
  try {
    // 55 llm rows from a reviewer generation: 53 agreed, 2 disagreed; both
    // disagreements reviewed. Floors: 55 >= 50 llm rows, 55 >= 20 reviewer
    // contexts -> passed.
    const reviewerCall = await store.recordCall(
      {
        use: "context-type",
        status: "advised",
        reviewer: true,
        model: "typesafe/jev-1.14",
        requestId: "req-1",
        generationId: "gen-1",
      },
      Array.from({ length: 55 }, (_, i) => ({
        questionIndex: i,
        mode: "shadow" as const,
        jevAnswer: "core",
        jevConfidence: 0.9,
        todayAnswer: "core",
        todaySource: "llm" as const,
        agreement: i < 53,
      })),
    );
    await store.setOwnerReview(reviewerCall.id, 53, "jev_better");
    await store.setOwnerReview(reviewerCall.id, 54, "llm_better");

    tracker.createJevDecisionAdvice.mockReturnValue({
      reviewerSub: REVIEWER_SUB,
    });
    tracker.getToken.mockResolvedValue({ sub: REVIEWER_SUB });
    tracker.getStore.mockReturnValue({ decisionReceipts: store });

    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      use: "context-type",
      mode: "shadow",
      total: 55,
      todaySource: { llm: 55, heuristic: 0, default: 0 },
      agreed: 53,
      disagreed: 2,
      llmCohort: {
        total: 55,
        agreed: 53,
        disagreed: 2,
        agreementRate: 53 / 55,
      },
      reviewerCohort: 55,
      ownerReview: {
        jev_better: 1,
        llm_better: 1,
        both_ok: 0,
        both_wrong: 0,
        none: 53,
      },
      floors: {
        llmRows: { required: 50, actual: 55, met: true },
        reviewerContexts: { required: 20, actual: 55, met: true },
      },
      passed: true,
    });
  } finally {
    await close();
  }
});

test("an undersized cohort reports not passed, never zero failures", async () => {
  const { store, close } = await seededStore();
  try {
    // 3 llm rows (2 disagreements) + 1 heuristic row from a reviewer
    // generation: both floors missed, but the report still carries the real
    // counts and the reviewed values — "not passed", not "0 failures".
    const small = await store.recordCall(
      {
        use: "context-type",
        status: "advised",
        reviewer: true,
        model: "typesafe/jev-1.14",
        requestId: "req-1",
        generationId: "gen-1",
      },
      [
        {
          questionIndex: 0,
          mode: "shadow",
          jevAnswer: "core",
          jevConfidence: 0.9,
          todayAnswer: "core",
          todaySource: "llm",
          agreement: true,
        },
        {
          questionIndex: 1,
          mode: "shadow",
          jevAnswer: "supporting",
          jevConfidence: 0.7,
          todayAnswer: "core",
          todaySource: "llm",
          agreement: false,
        },
        {
          questionIndex: 2,
          mode: "shadow",
          jevAnswer: "generic",
          jevConfidence: 0.7,
          todayAnswer: "core",
          todaySource: "llm",
          agreement: false,
        },
        {
          questionIndex: 3,
          mode: "shadow",
          jevAnswer: "generic",
          jevConfidence: 0.9,
          todayAnswer: "generic",
          todaySource: "heuristic",
          agreement: true,
        },
      ],
    );
    await store.setOwnerReview(small.id, 1, "both_wrong");

    tracker.createJevDecisionAdvice.mockReturnValue({
      reviewerSub: REVIEWER_SUB,
    });
    tracker.getToken.mockResolvedValue({ sub: REVIEWER_SUB });
    tracker.getStore.mockReturnValue({ decisionReceipts: store });

    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      llmCohort: { total: number };
      reviewerCohort: number;
      floors: {
        llmRows: { met: boolean };
        reviewerContexts: { met: boolean };
      };
      passed: boolean;
      ownerReview: Record<string, number>;
    };
    expect(body.llmCohort.total).toBe(3);
    expect(body.reviewerCohort).toBe(3);
    expect(body.floors.llmRows).toMatchObject({ actual: 3, met: false });
    expect(body.floors.reviewerContexts).toMatchObject({
      actual: 3,
      met: false,
    });
    expect(body.passed).toBe(false);
    expect(body.ownerReview).toMatchObject({ both_wrong: 1 });
  } finally {
    await close();
  }
});
