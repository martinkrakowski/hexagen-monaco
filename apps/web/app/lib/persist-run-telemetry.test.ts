import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { persistStageTelemetry } from "./persist-run-telemetry";

describe("persistStageTelemetry", () => {
  it("posts telemetry to the run-history API", () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    persistStageTelemetry({
      stage: 0,
      label: "Prompt Normalization",
      durationMs: 10,
      usedLLM: true,
      retryCount: 0,
      inputTokensEstimate: 4,
      outputTokensActual: 2,
      servedFromCache: false,
      summary: "ok",
      modelName: "mercury-2",
    });
    assert.equal(fetchImpl.mock.calls.length, 1);
    assert.equal(fetchImpl.mock.calls[0]?.[0], "/api/runs");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    assert.equal(init.method, "POST");
    vi.unstubAllGlobals();
  });
});
