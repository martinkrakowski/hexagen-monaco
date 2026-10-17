// @vitest-environment node
/**
 * Jev J5b: /api/jev/report behind the reviewer gate.
 *
 * The gate is exercised through the route with `next-auth/jwt` and
 * `wire.server` mocked exactly as spec/__tests__/route.jev.test.ts does (the
 * mock paths resolve to the modules the route actually imports; the shared
 * registry and helpers live in ../harness). The store underneath is the REAL
 * decision-receipts store on the shared test backends, seeded per case, so
 * the report's shape — and the full exit rule applied to it — is asserted
 * against real counts.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  tracker,
  REVIEWER_SUB,
  resetTracker,
  seededStore,
  closeOpenBackends,
  authorize,
} from "../../__tests__/harness";

vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => tracker.getToken(...(args as [])),
}));

vi.mock("../../../../../lib/platform", () => ({
  getPlatformStore: () => tracker.getStore(),
}));

// The report route reads the jev config for the exit rule's threshold (and
// nothing else): the mock resolves to the module the route actually imports.
vi.mock("../../../../../app/lib/wire.server", () => ({
  createJevDecisionAdvice: () => tracker.createJevDecisionAdvice(),
}));

const { GET } = await import("../route");

function get(): Promise<Response> {
  const request = new NextRequest("http://localhost/api/jev/report");
  return GET(request);
}

beforeEach(() => {
  resetTracker();
});

afterEach(async () => {
  await closeOpenBackends();
});

test("404 with no reviewerSub configured", async () => {
  const response = await get();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  // The gate answers before the store is touched.
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test("404 with a different sub", async () => {
  process.env.JEV_REVIEWER_SUB = REVIEWER_SUB;
  tracker.getToken.mockResolvedValue({ sub: "someone-else" });
  const response = await get();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test("404 when getToken throws", async () => {
  process.env.JEV_REVIEWER_SUB = REVIEWER_SUB;
  tracker.getToken.mockRejectedValue(new Error("bad token"));
  const response = await get();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test("404 when the env sub is set but the token differs", async () => {
  process.env.JEV_REVIEWER_SUB = REVIEWER_SUB;
  tracker.getToken.mockResolvedValue({ sub: "someone-else" });
  expect((await get()).status).toBe(404);
});

test("200 when the env sub is set and the token matches (positive guard)", async () => {
  const { store, close } = await seededStore();
  try {
    await store.recordCall(
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
      ],
    );
    process.env.JEV_REVIEWER_SUB = REVIEWER_SUB;
    tracker.getToken.mockResolvedValue({ sub: REVIEWER_SUB });
    tracker.getStore.mockReturnValue({ decisionReceipts: store });

    const response = await get();
    expect(response.status).toBe(200);
    expect(((await response.json()) as { total: number }).total).toBe(1);
  } finally {
    await close();
  }
});

/** Seed one reviewer call of `total` llm-baseline shadow rows. */
async function seedCohort(
  store: Awaited<ReturnType<typeof seededStore>>["store"],
  rows: Array<{
    agreement: boolean;
    jevConfidence: number;
    review?: "llm_better" | "jev_better";
  }>,
): Promise<void> {
  const reviewerCall = await store.recordCall(
    {
      use: "context-type",
      status: "advised",
      reviewer: true,
      model: "typesafe/jev-1.14",
      requestId: "req-1",
      generationId: "gen-1",
    },
    rows.map((row, i) => ({
      questionIndex: i,
      mode: "shadow" as const,
      jevAnswer: "core",
      jevConfidence: row.jevConfidence,
      todayAnswer: row.agreement ? "core" : "supporting",
      todaySource: "llm" as const,
      agreement: row.agreement,
    })),
  );
  for (const [i, row] of rows.entries()) {
    if (row.review) await store.setOwnerReview(reviewerCall.id, i, row.review);
  }
}

function authorizedOn(
  store: Awaited<ReturnType<typeof seededStore>>["store"],
): void {
  authorize();
  tracker.getStore.mockReturnValue({ decisionReceipts: store });
}

interface ExitRule {
  agreementRate: number | null;
  agreementMet: boolean;
  reviewedDisagreements: number;
  llmBetter: number;
  llmBetterAtOrAboveThreshold: number;
  llmBetterOk: boolean;
  confidenceOk: boolean;
}

interface ReportBody {
  passed: boolean;
  floorsMet: boolean;
  llmCohort: { total: number; agreed: number; agreementRate: number | null };
  exitRule: ExitRule;
}

test("the report's shape on a seeded sqlite store, every rule condition met", async () => {
  const { store, close } = await seededStore();
  try {
    // 100 llm rows from a reviewer generation: 90 agreed, 10 disagreed, all
    // reviewed, one of them llm_better below the 0.8 threshold. Floors:
    // 100 >= 50 llm rows, 100 >= 20 reviewer contexts; agreement 90/100 is
    // exactly 0.9; 1 llm_better in 10 reviewed is within 1 in 10; no
    // llm_better at or above the threshold -> passed.
    await seedCohort(store, [
      ...Array.from({ length: 90 }, () => ({
        agreement: true,
        jevConfidence: 0.9,
      })),
      { agreement: false, jevConfidence: 0.5, review: "llm_better" as const },
      ...Array.from({ length: 9 }, () => ({
        agreement: false,
        jevConfidence: 0.7,
        review: "jev_better" as const,
      })),
    ]);
    authorizedOn(store);

    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      use: "context-type",
      mode: "shadow",
      total: 100,
      todaySource: { llm: 100, heuristic: 0, default: 0 },
      agreed: 90,
      disagreed: 10,
      llmCohort: {
        total: 100,
        agreed: 90,
        disagreed: 10,
        agreementRate: 0.9,
      },
      reviewerCohort: 100,
      ownerReview: {
        jev_better: 9,
        llm_better: 1,
        both_ok: 0,
        both_wrong: 0,
        none: 90,
      },
      exitRule: {
        threshold: 0.8,
        agreementRate: 0.9,
        agreementMet: true,
        reviewedDisagreements: 10,
        llmBetter: 1,
        llmBetterAtOrAboveThreshold: 0,
        llmBetterOk: true,
        confidenceOk: true,
      },
      floors: {
        llmRows: { required: 50, actual: 100, met: true },
        reviewerContexts: { required: 20, actual: 100, met: true },
      },
      floorsMet: true,
      passed: true,
    });
  } finally {
    await close();
  }
});

test("floors met but llm agreement at 0.6 reports passed: false", async () => {
  const { store, close } = await seededStore();
  try {
    // 55 llm rows, only 33 agreed (0.6): the floors hold, no disagreement is
    // even reviewed, yet the 90% condition alone refuses `primary`.
    await seedCohort(store, [
      ...Array.from({ length: 33 }, () => ({
        agreement: true,
        jevConfidence: 0.9,
      })),
      ...Array.from({ length: 22 }, () => ({
        agreement: false,
        jevConfidence: 0.9,
      })),
    ]);
    authorizedOn(store);

    const body = (await (await get()).json()) as ReportBody;
    expect(body.passed).toBe(false);
    expect(body.floorsMet).toBe(true);
    expect(body.llmCohort.agreementRate).toBeCloseTo(0.6);
    expect(body.exitRule).toMatchObject({
      agreementMet: false,
      reviewedDisagreements: 0,
      llmBetter: 0,
      llmBetterAtOrAboveThreshold: 0,
      llmBetterOk: true,
      confidenceOk: true,
    });
  } finally {
    await close();
  }
});

test("too many llm_better reviews (more than 1 in 10) reports passed: false", async () => {
  const { store, close } = await seededStore();
  try {
    // 55 llm rows, 53 agreed, both disagreements reviewed llm_better with
    // sub-threshold confidence: 2 * 10 > 2 reviewed -> the rule refuses.
    await seedCohort(store, [
      ...Array.from({ length: 53 }, () => ({
        agreement: true,
        jevConfidence: 0.9,
      })),
      { agreement: false, jevConfidence: 0.5, review: "llm_better" as const },
      { agreement: false, jevConfidence: 0.5, review: "llm_better" as const },
    ]);
    authorizedOn(store);

    const body = (await (await get()).json()) as ReportBody;
    expect(body.passed).toBe(false);
    expect(body.exitRule).toMatchObject({
      agreementMet: true,
      reviewedDisagreements: 2,
      llmBetter: 2,
      llmBetterOk: false,
      confidenceOk: true,
    });
  } finally {
    await close();
  }
});

test("one llm_better at or above the confidence threshold reports passed: false", async () => {
  const { store, close } = await seededStore();
  try {
    // 100 llm rows, exactly 90 agreed (0.9), all 10 disagreements reviewed,
    // one of them llm_better with confidence 0.9 (>= 0.8): 1 in 10 is within
    // the rule, but the confidence condition alone refuses `primary`.
    await seedCohort(store, [
      ...Array.from({ length: 90 }, () => ({
        agreement: true,
        jevConfidence: 0.9,
      })),
      { agreement: false, jevConfidence: 0.9, review: "llm_better" as const },
      ...Array.from({ length: 9 }, () => ({
        agreement: false,
        jevConfidence: 0.5,
        review: "jev_better" as const,
      })),
    ]);
    authorizedOn(store);

    const body = (await (await get()).json()) as ReportBody;
    expect(body.passed).toBe(false);
    expect(body.exitRule).toMatchObject({
      agreementMet: true,
      reviewedDisagreements: 10,
      llmBetter: 1,
      llmBetterOk: true,
      llmBetterAtOrAboveThreshold: 1,
      confidenceOk: false,
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

    authorizedOn(store);

    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReportBody & {
      reviewerCohort: number;
      floors: {
        llmRows: { met: boolean };
        reviewerContexts: { met: boolean };
      };
      ownerReview: Record<string, number>;
    };
    expect(body.llmCohort.total).toBe(3);
    expect(body.reviewerCohort).toBe(3);
    expect(body.floors.llmRows).toMatchObject({ actual: 3, met: false });
    expect(body.floors.reviewerContexts).toMatchObject({
      actual: 3,
      met: false,
    });
    expect(body.floorsMet).toBe(false);
    expect(body.passed).toBe(false);
    expect(body.ownerReview).toMatchObject({ both_wrong: 1 });
  } finally {
    await close();
  }
});
