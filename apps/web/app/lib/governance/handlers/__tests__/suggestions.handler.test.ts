/**
 * Handler tests for `POST /api/governance/suggestions`.
 *
 * Ported from `app/api/governance/suggestions/__tests__/route.test.ts`, which
 * asserted its "the LLM was not called" invariants against a
 * `vi.mock("@hexagen/agentic-interaction")` factory. With the LLM behind a port
 * the fake is an explicit argument, so the guard assertions no longer depend on
 * module-mock resolution order.
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  handleGovernanceSuggestions,
  type GovernanceSuggestionsDeps,
} from "../suggestions.handler";
import type { SuggestionOutcome } from "../../ports";
import {
  MAX_MANIFEST_YAML_CHARS,
  MAX_OPEN_FILE_CONTENT_CHARS,
} from "../../../request-guards";

function deps(
  outcome: SuggestionOutcome = { kind: "suggestions", suggestions: [] },
) {
  const suggest = vi.fn(async () => outcome);
  const value: GovernanceSuggestionsDeps = { suggestions: { suggest } };
  return { deps: value, suggest };
}

/** Same-origin (no Origin header) POST, so the D1 gate lets it through. */
function post(body: BodyInit): NextRequest {
  return new NextRequest("http://localhost/api/governance/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost" },
    body,
  });
}

function postJson(manifestYaml: unknown) {
  return post(
    JSON.stringify(manifestYaml === undefined ? {} : { manifestYaml }),
  );
}

function postRawBody(value: unknown) {
  return post(JSON.stringify(value));
}

function postMalformed() {
  return post("{ this is not valid json ");
}

describe("POST /api/governance/suggestions", () => {
  it("returns the port's suggestions with no error field", async () => {
    const { deps: d } = deps({
      kind: "suggestions",
      suggestions: [
        {
          id: "1",
          message: "Split the context",
          confidence: 80,
          category: "context-split",
        },
      ],
    });
    const res = await handleGovernanceSuggestions(
      postJson("bounded_contexts: []"),
      d,
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.suggestions.length, 1);
    assert.equal(body.error, undefined);
  });

  it("surfaces an unavailable model as { suggestions: [], error } — the shape useGovernanceData reads", async () => {
    const { deps: d } = deps({
      kind: "unavailable",
      reason: "LLM API key not configured",
    });
    const res = await handleGovernanceSuggestions(
      postJson("bounded_contexts: []"),
      d,
    );
    const body = await res.json();
    assert.deepEqual(body.suggestions, []);
    assert.equal(body.error, "LLM API key not configured");
  });

  it("400s when manifestYaml is missing", async () => {
    const { deps: d } = deps();
    assert.equal(
      (await handleGovernanceSuggestions(postJson(undefined), d)).status,
      400,
    );
  });

  it("400s a malformed JSON body BEFORE calling the suggestion port (not a 500)", async () => {
    const { deps: d, suggest } = deps();
    const res = await handleGovernanceSuggestions(postMalformed(), d);
    assert.equal(res.status, 400);
    // Assert the parse-guard's OWN message, not just any 400 — so this can't be
    // silently satisfied by guardManifestBody 400ing an undefined body instead.
    assert.match((await res.json()).error, /valid json/i);
    assert.equal(suggest.mock.calls.length, 0);
  });

  it("400s a null JSON body instead of throwing to a 500", async () => {
    const { deps: d } = deps();
    assert.equal(
      (await handleGovernanceSuggestions(postRawBody(null), d)).status,
      400,
    );
  });

  it("400s an object-valued manifestYaml (would slip past the size guard)", async () => {
    const { deps: d } = deps();
    assert.equal(
      (await handleGovernanceSuggestions(postJson({ nested: true }), d)).status,
      400,
    );
  });

  it("400s an over-large manifest BEFORE calling the suggestion port", async () => {
    const { deps: d, suggest } = deps();
    const res = await handleGovernanceSuggestions(
      postJson("a".repeat(MAX_MANIFEST_YAML_CHARS + 1)),
      d,
    );
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /too large/i);
    assert.equal(suggest.mock.calls.length, 0);
  });

  it("400s an over-large openFileContent BEFORE calling the suggestion port", async () => {
    // openFileContent is appended verbatim to the prompt, so a huge open file
    // re-opens the same LLM-resource surface the manifest cap closes.
    const { deps: d, suggest } = deps();
    const res = await handleGovernanceSuggestions(
      postRawBody({
        manifestYaml: "bounded_contexts: []",
        openFileContent: "a".repeat(MAX_OPEN_FILE_CONTENT_CHARS + 1),
      }),
      d,
    );
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /too large/i);
    assert.equal(suggest.mock.calls.length, 0);
  });

  it("400s a non-string openFileContent BEFORE calling the suggestion port", async () => {
    const { deps: d, suggest } = deps();
    const res = await handleGovernanceSuggestions(
      postRawBody({
        manifestYaml: "bounded_contexts: []",
        openFileContent: { not: "a string" },
      }),
      d,
    );
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /must be a string/i);
    assert.equal(suggest.mock.calls.length, 0);
  });

  it("rejects a cross-origin POST with 403 before calling the suggestion port", async () => {
    // This route reaches the LLM on the caller's word alone.
    const { deps: d, suggest } = deps();
    const req = new NextRequest("http://localhost/api/governance/suggestions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://evil.example",
        host: "localhost",
      },
      body: JSON.stringify({ manifestYaml: "bounded_contexts: []" }),
    });

    const res = await handleGovernanceSuggestions(req, d);

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /cross-origin/i);
    // The status alone would still pass if the gate ran after the model call.
    assert.equal(suggest.mock.calls.length, 0);
  });
});
