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
  beforeEach(() => {
    closePlatformStore();
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
});
