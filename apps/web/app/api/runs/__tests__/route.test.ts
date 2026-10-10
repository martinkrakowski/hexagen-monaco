import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { GET, POST } from "../route";
import { closePlatformStore } from "../../../../lib/platform";

const telemetry = {
  stage: 1,
  label: "Domain Extraction",
  durationMs: 800,
  usedLLM: true,
  retryCount: 0,
  inputTokensEstimate: 200,
  outputTokensActual: 80,
  servedFromCache: false,
  summary: "3 contexts",
  modelName: "gpt-4o",
};

describe("/api/runs", () => {
  beforeEach(async () => {
    await closePlatformStore();
    vi.mocked(getToken).mockResolvedValue({ sub: "user-a" } as never);
  });
  afterEach(() => closePlatformStore());

  it("rejects a missing JWT with 401", async () => {
    vi.mocked(getToken).mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/runs"));
    assert.equal(res.status, 401);
  });

  it("persists telemetry and returns it with a trend, without a 501", async () => {
    const created = await POST(
      new NextRequest("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: "run-a", telemetry }),
      }),
    );
    assert.equal(created.status, 201);
    const recorded = (await created.json()) as { costCents: number | null };
    assert.equal(typeof recorded.costCents, "number");

    const listed = await GET(new NextRequest("http://localhost/api/runs"));
    assert.equal(listed.status, 200);
    const body = (await listed.json()) as {
      events: unknown[];
      trend: unknown[];
    };
    assert.equal(body.events.length, 1);
    assert.ok(Array.isArray(body.trend));

    vi.mocked(getToken).mockResolvedValue({ sub: "user-b" } as never);
    const other = await GET(new NextRequest("http://localhost/api/runs"));
    assert.equal((await other.json()).events.length, 0);
  });

  it.each([
    ["stage", 1.5],
    ["retryCount", 1.5],
    ["inputTokensEstimate", 1.5],
    ["outputTokensActual", 1.5],
    ["durationMs", 1.5],
    ["stage", -1],
    ["retryCount", -1],
    ["inputTokensEstimate", -1],
    ["outputTokensActual", -1],
    ["durationMs", -1],
    ["stage", 2147483648],
    ["retryCount", 2147483648],
    ["inputTokensEstimate", 2147483648],
    ["outputTokensActual", 2147483648],
    ["durationMs", Number.MAX_SAFE_INTEGER + 2],
  ])(
    "rejects fractional, negative and out-of-range whole numbers (400, nothing recorded)",
    async (field, value) => {
      const res = await POST(
        new NextRequest("http://localhost/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: "run-a",
            telemetry: { ...telemetry, [field]: value } as typeof telemetry,
          }),
        }),
      );
      assert.equal(res.status, 400);

      const listed = await GET(new NextRequest("http://localhost/api/runs"));
      assert.equal(listed.status, 200);
      const body = (await listed.json()) as { events: unknown[] };
      assert.equal(body.events.length, 0);
    },
  );

  it("accepts boundary whole-number values (201)", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "run-a",
          telemetry: {
            ...telemetry,
            // Unpriced on purpose: a priced model at these token counts
            // derives a cost that no longer fits cost_cents (see the 400
            // test below). Here the cost is null and the 201 stands.
            modelName: "boundary-unpriced-model",
            stage: 2147483647,
            durationMs: 0,
            retryCount: 2147483647,
            inputTokensEstimate: 2147483647,
            outputTokensActual: 2147483647,
          },
        }),
      }),
    );
    assert.equal(res.status, 201);
  });

  it("answers 400 when the computed cost exceeds the integer column", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "run-a",
          telemetry: {
            ...telemetry,
            inputTokensEstimate: 2147483647,
            outputTokensActual: 2147483647,
          },
        }),
      }),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, "validation");

    const listed = await GET(new NextRequest("http://localhost/api/runs"));
    assert.equal(listed.status, 200);
    const listBody = (await listed.json()) as { events: unknown[] };
    assert.equal(listBody.events.length, 0);
  });
});
