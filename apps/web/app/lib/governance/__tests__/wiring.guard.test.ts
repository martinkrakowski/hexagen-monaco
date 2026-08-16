/**
 * Wiring guard.
 *
 * The handler tests inject fakes, so nothing there would notice if
 * `wire.server.ts` stopped handing the routes a real adapter — the classic hole
 * that opens when I/O moves behind a port. This test loads the real composition
 * root and asserts the two governance getters return the concrete adapters,
 * memoized, with no fakes anywhere in the file.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { getGovernanceSuggestions, getManifestLint } from "../../wire.server";
import { CliManifestLintAdapter } from "../adapters/cli-manifest-lint.adapter";
import { LlmSuggestionAdapter } from "../adapters/llm-suggestion.adapter";

describe("governance composition root", () => {
  it("wires ManifestLintPort to the CLI adapter", () => {
    assert.ok(getManifestLint() instanceof CliManifestLintAdapter);
  });

  it("wires SuggestionPort to the LLM adapter", () => {
    assert.ok(getGovernanceSuggestions() instanceof LlmSuggestionAdapter);
  });

  it("memoizes both, so a request does not re-resolve the monorepo root", () => {
    assert.equal(getManifestLint(), getManifestLint());
    assert.equal(getGovernanceSuggestions(), getGovernanceSuggestions());
  });

  it("reaches the handler through the real route module", async () => {
    // Loads `route.ts` with nothing mocked, so the shim's imports, the
    // composition root and the handler are all the production ones. A
    // cross-origin POST is used because the D1 gate short-circuits before any
    // I/O — this asserts the wiring, not the linter.
    const { POST } = await import("../../../api/governance/refresh/route");
    const res = await POST(
      new NextRequest("http://localhost/api/governance/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://evil.example",
          host: "localhost",
        },
        body: JSON.stringify({ manifestYaml: "bounded_contexts: []" }),
      }),
    );
    assert.equal(res.status, 403);
  });
});
