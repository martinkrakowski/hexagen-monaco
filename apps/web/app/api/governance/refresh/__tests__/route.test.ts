import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// A cross-origin request is rejected by the mutation gate before any analysis
// runs, so the LLM/use-case boundaries are stubbed only to keep module import
// cheap and side-effect-free.
vi.mock("@/lib/wire.shared", () => ({
  resolveWebLlmApiKey: vi.fn(() => undefined),
}));
vi.mock("@hexagen/agentic-interaction", () => ({
  GenerateSuggestionUseCase: class {},
  ServerLLMAdapter: class {},
}));

import { POST } from "../route";

describe("POST /api/governance/refresh — mutation gate (D1)", () => {
  it("rejects a cross-origin POST with 403 before spawning lint:arch / calling the LLM", async () => {
    const req = new NextRequest("http://localhost/api/governance/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://evil.example",
        host: "localhost",
      },
      body: JSON.stringify({ manifestYaml: "bounded_contexts: []" }),
    });

    const res = await POST(req);

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /cross-origin/i);
  });
});
