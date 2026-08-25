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

  it("forwards the active tenant, and omits it for the personal path (H1.5)", () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const telemetry = {
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
    };

    persistStageTelemetry(telemetry, { tenantId: "org-acme" });
    persistStageTelemetry(telemetry);

    const bodyOf = (i: number) =>
      JSON.parse(
        (fetchImpl.mock.calls[i]?.[1] as RequestInit).body as string,
      ) as { tenantId?: string };

    assert.equal(fetchImpl.mock.calls.length, 2);
    assert.equal(
      bodyOf(0).tenantId,
      "org-acme",
      "an org run must name its tenant, or the server writes it to the poster",
    );
    assert.equal(
      bodyOf(1).tenantId,
      undefined,
      "the personal path must stay tenant-less",
    );
    vi.unstubAllGlobals();
  });
});
