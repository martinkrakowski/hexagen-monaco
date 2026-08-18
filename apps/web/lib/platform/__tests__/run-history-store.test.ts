import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";
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

describe("run history + price table", () => {
  it("computes cost-per-run from the seeded price table", () => {
    const cents = computeCostCents(1000, 400, {
      usdPer1kInput: 0.25,
      usdPer1kOutput: 1.25,
    });
    assert.equal(cents, 75);
    assert.equal(computeCostCents(10, 10, null), null);
  });

  it("persists telemetry and groups a daily trend", () => {
    const store = createPlatformStore(":memory:");
    const runs = store.runsFor("owner-a");
    const day = Date.UTC(2026, 7, 17, 12, 0, 0);
    const first = runs.record({
      runId: "run-1",
      projectId: "11111111-1111-4111-8111-111111111111",
      telemetry,
      now: day,
    });
    assert.equal(first.model, "mercury-2");
    assert.equal(first.costCents, 75);
    runs.record({
      runId: "run-1",
      telemetry: { ...telemetry, stage: 4, label: "Adapter Assignment" },
      now: day + 1,
    });
    runs.record({
      runId: "run-2",
      telemetry: { ...telemetry, modelName: "unknown-model" },
      now: day + 2,
    });

    const listed = runs.list({ limit: 10 });
    assert.equal(listed.length, 3);
    assert.equal(listed[0]?.runId, "run-2");
    assert.equal(listed[0]?.costCents, null);

    const trend = runs.trend(30);
    assert.equal(trend.length, 1);
    assert.equal(trend[0]?.runs, 2);
    assert.equal(store.runsFor("owner-b").list().length, 0);
    store.close();
  });

  it("upserts the same owner/run/stage so reconnects do not double cost", () => {
    const store = createPlatformStore(":memory:");
    const runs = store.runsFor("owner-a");
    const day = Date.UTC(2026, 7, 17, 12, 0, 0);
    runs.record({
      runId: "run-1",
      telemetry,
      now: day,
    });
    runs.record({
      runId: "run-1",
      telemetry: { ...telemetry, durationMs: 2400 },
      now: day + 10,
    });
    const listed = runs.list({ limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.durationMs, 2400);
    const trend = runs.trend(30);
    assert.equal(trend.length, 1);
    assert.equal(trend[0]?.runs, 1);
    assert.equal(trend[0]?.costCents, 75);
    store.close();
  });
});
