// @vitest-environment node
/**
 * Jev J5b: /api/jev/review behind the reviewer gate.
 *
 * Gate mocks follow spec/__tests__/route.jev.test.ts (mock paths resolve to
 * the modules the route actually imports); the store underneath is the REAL
 * decision-receipts store on a sqlite backend, so the 404 cases include the
 * store's own refusals (unknown row, non-reviewer call) and the 200 case is
 * verified by re-reading through the store.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DecisionReceiptsStore } from "../../../../../lib/platform/decision-receipts-store";

const tracker = vi.hoisted(() => {
  return {
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

const { POST } = await import("../route");

const REVIEWER_SUB = "reviewer-sub";

function post(body: unknown): Promise<Response> {
  const request = new NextRequest("http://localhost/api/jev/review", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return POST(request);
}

const openBackends: Array<() => Promise<void>> = [];

async function seededStore(): Promise<{
  store: DecisionReceiptsStore;
  close: () => Promise<void>;
}> {
  const { openBackend } =
    await import("../../../../../test-support/platform-backends");
  const { createDecisionReceiptsStore } =
    await import("../../../../../lib/platform/decision-receipts-store");
  const backend = await openBackend("sqlite");
  openBackends.push(() => backend.close());
  return {
    store: createDecisionReceiptsStore(backend.db),
    close: () => backend.close(),
  };
}

async function authorizedStore(): Promise<DecisionReceiptsStore> {
  const { store } = await seededStore();
  tracker.getStore.mockReturnValue({ decisionReceipts: store });
  return store;
}

function authorize(): void {
  tracker.createJevDecisionAdvice.mockReturnValue({
    reviewerSub: REVIEWER_SUB,
  });
  tracker.getToken.mockResolvedValue({ sub: REVIEWER_SUB });
}

beforeEach(() => {
  tracker.createJevDecisionAdvice.mockReset().mockReturnValue(null);
  tracker.getToken.mockReset().mockResolvedValue(null);
  tracker.getStore.mockReset();
  delete process.env.JEV_REVIEWER_SUB;
});

afterEach(async () => {
  while (openBackends.length > 0) {
    await openBackends.pop()!();
  }
});

test("404 with no reviewerSub, before the body is even read", async () => {
  const response = await post({
    callId: "x",
    questionIndex: 0,
    review: "both_ok",
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test("404 with a different sub, and the store is never touched", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue({
    reviewerSub: REVIEWER_SUB,
  });
  tracker.getToken.mockResolvedValue({ sub: "someone-else" });
  const response = await post({
    callId: "x",
    questionIndex: 0,
    review: "both_ok",
  });
  expect(response.status).toBe(404);
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test("404 when getToken throws", async () => {
  tracker.createJevDecisionAdvice.mockReturnValue({
    reviewerSub: REVIEWER_SUB,
  });
  tracker.getToken.mockRejectedValue(new Error("bad token"));
  expect(
    (await post({ callId: "x", questionIndex: 0, review: "both_ok" })).status,
  ).toBe(404);
  // The gate answers before the store is touched.
  expect(tracker.getStore).not.toHaveBeenCalled();
});

test.each([
  ["not JSON", "{oops"],
  ["missing callId", { questionIndex: 0, review: "both_ok" }],
  ["empty callId", { callId: "", questionIndex: 0, review: "both_ok" }],
  [
    "non-integer questionIndex",
    { callId: "c", questionIndex: 1.5, review: "both_ok" },
  ],
  [
    "negative questionIndex",
    { callId: "c", questionIndex: -1, review: "both_ok" },
  ],
  [
    "review outside the closed set",
    { callId: "c", questionIndex: 0, review: "jev_won" },
  ],
  ["missing review", { callId: "c", questionIndex: 0 }],
] as Array<[string, unknown]>)("400 for %s", async (_case, body) => {
  authorize();
  await authorizedStore();

  const response = await post(body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "bad_request" });
});

test("404 for an unknown row", async () => {
  authorize();
  await authorizedStore();

  const response = await post({
    callId: "99999999-9999-4999-8999-999999999999",
    questionIndex: 0,
    review: "both_ok",
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});

test("404 for a call that is not reviewer=true", async () => {
  authorize();
  const store = await authorizedStore();

  const notReviewer = await store.recordCall(
    {
      use: "context-type",
      status: "advised",
      reviewer: false,
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
        todayAnswer: "supporting",
        todaySource: "llm",
        agreement: false,
      },
    ],
  );
  const response = await post({
    callId: notReviewer.id,
    questionIndex: 0,
    review: "jev_better",
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});

test("200 writes the review and a re-read shows the value", async () => {
  authorize();
  const store = await authorizedStore();

  const recorded = await store.recordCall(
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
        todayAnswer: "supporting",
        todaySource: "llm",
        agreement: false,
      },
    ],
  );

  const response = await post({
    callId: recorded.id,
    questionIndex: 0,
    review: "llm_better",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });

  const [after] = await store.getAnswers(recorded.id);
  expect(after.ownerReview).toBe("llm_better");
});
