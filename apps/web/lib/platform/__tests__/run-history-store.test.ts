// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
import { computeCostCents } from "../run-history-store";

const telemetry = {
  stage: 3,
  label: "Port Mapping",
  durationMs: 1200,
  usedLLM: true,
  retryCount: 1,
  inputTokensEstimate: 1000,
  outputTokensActual: 400,
  servedFromCache: false,
  summary: "mapped 4 ports",
  modelName: "mercury-2",
};

/**
 * Noon UTC, `daysAgo` days back. The trend window is computed from `Date.now()`
 * inside `trend()` (run-history-store.ts:254), so a record seeded at a fixed
 * calendar date silently ages out of it: this suite pinned 2026-08-17 and began
 * failing on 2026-09-17, thirty-one days later, with no code change. Seeding
 * relative to now keeps the record inside any window these tests ask for, and
 * snapping to noon UTC keeps both records of a pair on the same UTC day so the
 * daily grouping stays a single row regardless of when the suite runs.
 */
function noonUtcDaysAgo(daysAgo: number): number {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    12,
    0,
    0,
  );
}

describe("run history + price table", () => {
  it("computes cost-per-run from the seeded price table", () => {
    const cents = computeCostCents(1000, 400, {
      usdPer1kInput: 0.25,
      usdPer1kOutput: 1.25,
    });
    assert.equal(cents, 75);
    assert.equal(computeCostCents(10, 10, null), null);
  });
});

describe.each(BACKENDS)("run history store (%s)", (kind) => {
  it("persists telemetry and groups a daily trend", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const runs = store.runsFor("owner-a");
      const day = noonUtcDaysAgo(1);
      const first = await runs.record({
        runId: "run-1",
        projectId: "11111111-1111-4111-8111-111111111111",
        telemetry,
        now: day,
      });
      assert.equal(first.model, "mercury-2");
      assert.equal(first.costCents, 75);
      await runs.record({
        runId: "run-1",
        telemetry: { ...telemetry, stage: 4, label: "Adapter Assignment" },
        now: day + 1,
      });
      await runs.record({
        runId: "run-2",
        telemetry: { ...telemetry, modelName: "unknown-model" },
        now: day + 2,
      });

      const listed = await runs.list({ limit: 10 });
      assert.equal(listed.length, 3);
      assert.equal(listed[0]?.runId, "run-2");
      assert.equal(listed[0]?.costCents, null);

      const trend = await runs.trend(30);
      assert.equal(trend.length, 1);
      assert.equal(trend[0]?.runs, 2);
      assert.equal((await store.runsFor("owner-b").list()).length, 0);
    } finally {
      await backend.close();
    }
  });

  it("upserts the same owner/run/stage so reconnects do not double cost", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const runs = store.runsFor("owner-a");
      const day = noonUtcDaysAgo(1);
      await runs.record({
        runId: "run-1",
        telemetry,
        now: day,
      });
      await runs.record({
        runId: "run-1",
        telemetry: { ...telemetry, durationMs: 2400 },
        now: day + 10,
      });
      const listed = await runs.list({ limit: 10 });
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.durationMs, 2400);
      const trend = await runs.trend(30);
      assert.equal(trend.length, 1);
      assert.equal(trend[0]?.runs, 1);
      assert.equal(trend[0]?.costCents, 75);
    } finally {
      await backend.close();
    }
  });

  it("R1 createdAt is a number on record and on list, and both flags round-trip as true and false", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const runs = store.runsFor("owner-a");
      const now = noonUtcDaysAgo(0);
      const first = await runs.record({
        runId: "run-1",
        telemetry: {
          ...telemetry,
          stage: 3,
          servedFromCache: true,
          usedLLM: false,
        },
        now,
      });
      assert.equal(typeof first.createdAt, "number");
      assert.equal(first.createdAt, now);
      assert.equal(first.servedFromCache, true);
      assert.equal(first.usedLlm, false);
      const second = await runs.record({
        runId: "run-2",
        telemetry: {
          ...telemetry,
          stage: 3,
          servedFromCache: false,
          usedLLM: true,
        },
        now,
      });
      assert.equal(typeof second.createdAt, "number");
      assert.equal(second.createdAt, now);
      assert.equal(second.servedFromCache, false);
      assert.equal(second.usedLlm, true);
    } finally {
      await backend.close();
    }
  });

  it("R2 the same owner, run and stage is one row; a different stage, run or owner is another", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const runs = store.runsFor("owner-a");
      const day = noonUtcDaysAgo(1);
      await runs.record({
        runId: "run-1",
        telemetry: { ...telemetry, stage: 3, summary: "first" },
        now: day,
      });
      await runs.record({
        runId: "run-1",
        telemetry: { ...telemetry, stage: 3, summary: "second" },
        now: day + 10,
      });
      const listed = await runs.list({ limit: 10 });
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.summary, "second");
      assert.equal(listed[0]?.createdAt, day + 10);

      await runs.record({
        runId: "run-1",
        telemetry: { ...telemetry, stage: 4, summary: "stage-4" },
        now: day + 20,
      });
      const listed2 = await runs.list({ limit: 10 });
      assert.equal(listed2.length, 2);

      const other = store.runsFor("owner-b");
      await other.record({
        runId: "run-1",
        telemetry: { ...telemetry, stage: 3, summary: "owner-b" },
        now: day + 30,
      });
      const listed3 = await runs.list({ limit: 10 });
      assert.equal(listed3.length, 2);
    } finally {
      await backend.close();
    }
  });

  it("R3 list honours limit, orders newest first and filters by project", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const runs = store.runsFor("owner-a");
      const d = noonUtcDaysAgo(1);
      const projA = "11111111-1111-4111-8111-111111111111";
      const projB = "22222222-2222-4222-8222-222222222222";
      await runs.record({
        runId: "r1",
        projectId: projA,
        telemetry: { ...telemetry, stage: 3 },
        now: d,
      });
      await runs.record({
        runId: "r2",
        projectId: projB,
        telemetry: { ...telemetry, stage: 3 },
        now: d + 1,
      });
      await runs.record({
        runId: "r3",
        projectId: projA,
        telemetry: { ...telemetry, stage: 3 },
        now: d + 2,
      });

      const limited = await runs.list({ limit: 2 });
      assert.equal(limited.length, 2);
      assert.equal(limited[0]?.runId, "r3");
      assert.equal(limited[1]?.runId, "r2");

      const forProjA = await runs.list({ projectId: projA });
      assert.equal(forProjA.length, 2);
      assert.equal(forProjA[0]?.runId, "r3");
      assert.equal(forProjA[1]?.runId, "r1");

      const all = await runs.list();
      assert.equal(all.length, 3);

      const otherOwner = store.runsFor("owner-b");
      assert.equal((await otherOwner.list()).length, 0);
    } finally {
      await backend.close();
    }
  });

  it("R4 the trend groups by UTC day, counts distinct runs, and excludes events before the window", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const runs = store.runsFor("owner-a");
      const now = Date.now();
      const midnight = Math.floor(now / 86_400_000) * 86_400_000;
      const prevDay = midnight - 1;
      const yesterday = new Date(prevDay).toISOString().slice(0, 10);
      const today = new Date(midnight).toISOString().slice(0, 10);

      // Day boundary: two events same run on prevDay (distinct → 1), one on today
      await runs.record({ runId: "run-a", telemetry, now: prevDay });
      await runs.record({
        runId: "run-a",
        telemetry: { ...telemetry, stage: 4 },
        now: prevDay,
      });
      await runs.record({ runId: "run-b", telemetry, now: midnight });

      const trend = await runs.trend(30);
      assert.equal(trend.length, 2);
      assert.equal(trend[0]?.day, yesterday);
      assert.equal(trend[1]?.day, today);
      assert.equal(typeof trend[0]?.runs, "number");
      assert.equal(trend[0]?.runs, 1);
      assert.equal(typeof trend[0]?.costCents, "number");
      assert.equal(trend[0]?.costCents, 150);

      // Window: trend(1) includes 23h ago, excludes 25h ago; other owner excluded
      const runsB = store.runsFor("owner-b");
      const h23 = now - 23 * 60 * 60 * 1000;
      const h25 = now - 25 * 60 * 60 * 1000;
      await runsB.record({ runId: "run-c", telemetry, now: h23 });
      await runsB.record({ runId: "run-d", telemetry, now: h25 });
      await store.runsFor("owner-c").record({ runId: "run-e", telemetry, now });

      const recent = await runsB.trend(1);
      assert.equal(recent.length, 1);
      assert.equal(typeof recent[0]?.runs, "number");
      assert.equal(recent[0]?.runs, 1);
    } finally {
      await backend.close();
    }
  });

  it("R5 price lookup finds the seeded price and the provider-prefixed alias", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const runs = store.runsFor("owner-a");
      const now = noonUtcDaysAgo(1);
      const withPrice = await runs.record({
        runId: "run-1",
        telemetry: { ...telemetry, modelName: "gpt-4o" },
        now,
      });
      assert.notEqual(withPrice.costCents, null);
      const withAlias = await runs.record({
        runId: "run-2",
        telemetry: { ...telemetry, modelName: "openai/gpt-4o" },
        now,
      });
      assert.notEqual(withAlias.costCents, null);
      const withNone = await runs.record({
        runId: "run-3",
        telemetry: { ...telemetry, modelName: "nonexistent-model" },
        now,
      });
      assert.equal(withNone.costCents, null);
    } finally {
      await backend.close();
    }
  });

  it("R6 a fractional duration is stored rounded and does not fail", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const runs = store.runsFor("owner-a");
      const recorded = await runs.record({
        runId: "run-1",
        telemetry: { ...telemetry, durationMs: 12.5 },
        now: noonUtcDaysAgo(1),
      });
      assert.equal(recorded.durationMs, 13);
    } finally {
      await backend.close();
    }
  });
});
