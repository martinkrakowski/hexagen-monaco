/**
 * Handler tests for `POST /api/governance/refresh`.
 *
 * These drive `handleGovernanceRefresh` with explicit fake ports. Nothing is
 * module-mocked: the guards, the manifest analyzer and the response mapping are
 * all the real thing, and the fakes stand only where a subprocess and a network
 * call used to be. The subprocess/filesystem behaviour they replace is covered
 * for real in `app/lib/governance/adapters/__tests__`.
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  handleGovernanceRefresh,
  type GovernanceRefreshDeps,
} from "../refresh.handler";
import type { ManifestLintOutcome, SuggestionOutcome } from "../../ports";
import {
  MAX_MANIFEST_YAML_CHARS,
  MAX_OPEN_FILE_CONTENT_CHARS,
} from "../../../request-guards";

function deps(
  lintOutcome: ManifestLintOutcome = { kind: "clean" },
  suggestionOutcome: SuggestionOutcome = {
    kind: "suggestions",
    suggestions: [],
  },
) {
  const lintManifest = vi.fn(async () => lintOutcome);
  const suggest = vi.fn(async () => suggestionOutcome);
  const value: GovernanceRefreshDeps = {
    lint: { lintManifest },
    suggestions: { suggest },
  };
  return { deps: value, lintManifest, suggest };
}

/** Same-origin (no Origin header) refresh POST from a raw JSON body. */
function sameOriginPost(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/governance/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost" },
    body: JSON.stringify(body),
  });
}

function sameOriginMalformed(): NextRequest {
  return new NextRequest("http://localhost/api/governance/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost" },
    body: "{ this is not valid json ",
  });
}

describe("governance/refresh — outcome mapping (HEX-016)", () => {
  it("reports a linter that could not run as lintError, never as violations", async () => {
    const { deps: d } = deps({
      kind: "unavailable",
      reason: "Command failed: yarn lint:arch",
    });

    const res = await handleGovernanceRefresh(
      sameOriginPost({ manifestYaml: "bounded_contexts: []" }),
      d,
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(
      body.violations,
      [],
      "a toolchain failure is not an architectural violation",
    );
    assert.match(body.lintError, /Architecture linter unavailable/);
    assert.match(body.lintError, /yarn lint:arch/);
  });

  it("maps real violations to HIGH errors and omits lintError", async () => {
    const { deps: d } = deps({
      kind: "violations",
      messages: ["Layer Violation: domain imports infrastructure"],
    });

    const res = await handleGovernanceRefresh(
      sameOriginPost({ manifestYaml: "bounded_contexts: []" }),
      d,
    );
    const body = await res.json();

    assert.deepEqual(body.violations, [
      {
        id: "1",
        type: "error",
        message: "Layer Violation: domain imports infrastructure",
        severity: "HIGH",
      },
    ]);
    assert.equal(body.lintError, undefined);
  });

  it("omits lintError on a clean run", async () => {
    const { deps: d } = deps({ kind: "clean" });
    const res = await handleGovernanceRefresh(
      sameOriginPost({ manifestYaml: "bounded_contexts: []" }),
      d,
    );
    const body = await res.json();
    assert.deepEqual(body.violations, []);
    assert.equal(body.lintError, undefined);
  });

  it("reports a failed suggestion call as suggestionsError, not zero suggestions", async () => {
    const { deps: d } = deps(
      { kind: "clean" },
      {
        kind: "unavailable",
        reason: "LLM upstream 503",
      },
    );

    const res = await handleGovernanceRefresh(
      sameOriginPost({ manifestYaml: "bounded_contexts: []" }),
      d,
    );
    const body = await res.json();

    assert.deepEqual(body.suggestions, []);
    assert.equal(
      body.suggestionsError,
      "LLM upstream 503",
      "an LLM failure must not read as a clean, suggestion-free manifest",
    );
  });

  it("omits suggestionsError when a model genuinely returned nothing", async () => {
    // The distinction the old route could not express: an empty list from a
    // model that ran is not the same as no model running.
    const { deps: d } = deps(
      { kind: "clean" },
      {
        kind: "suggestions",
        suggestions: [],
      },
    );

    const res = await handleGovernanceRefresh(
      sameOriginPost({ manifestYaml: "bounded_contexts: []" }),
      d,
    );
    const body = await res.json();

    assert.deepEqual(body.suggestions, []);
    assert.equal(body.suggestionsError, undefined);
  });

  it("still surfaces a manifest parse failure as statusError (AUD-005, item 1.6)", async () => {
    const { deps: d } = deps();
    const res = await handleGovernanceRefresh(
      sameOriginPost({ manifestYaml: "bounded_contexts: [unclosed" }),
      d,
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.portAdapterStatus, []);
    assert.match(body.statusError, /parse/i);
  });

  it("passes the open file through to the suggestion port", async () => {
    const { deps: d, suggest } = deps();
    await handleGovernanceRefresh(
      sameOriginPost({
        manifestYaml: "bounded_contexts: []",
        openFileContent: "export const a = 1;",
      }),
      d,
    );
    assert.deepEqual(suggest.mock.calls[0][0], {
      manifestYaml: "bounded_contexts: []",
      openFileContent: "export const a = 1;",
    });
  });
});

describe("governance/refresh — mutation gate (D1) and input guards", () => {
  it("rejects a cross-origin POST with 403 before linting / calling the LLM", async () => {
    const { deps: d, lintManifest, suggest } = deps();
    const req = new NextRequest("http://localhost/api/governance/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://evil.example",
        host: "localhost",
      },
      body: JSON.stringify({ manifestYaml: "bounded_contexts: []" }),
    });

    const res = await handleGovernanceRefresh(req, d);

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /cross-origin/i);
    // The guard must short-circuit BEFORE any downstream work. A regression
    // that ran either port before returning 403 would still satisfy the status
    // assertion above but fail here.
    assert.equal(lintManifest.mock.calls.length, 0);
    assert.equal(suggest.mock.calls.length, 0);
  });

  it("400s an over-large manifest BEFORE linting / calling the LLM", async () => {
    const { deps: d, lintManifest, suggest } = deps();
    const res = await handleGovernanceRefresh(
      sameOriginPost({ manifestYaml: "a".repeat(MAX_MANIFEST_YAML_CHARS + 1) }),
      d,
    );

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /too large/i);
    assert.equal(lintManifest.mock.calls.length, 0);
    assert.equal(suggest.mock.calls.length, 0);
  });

  it("400s a malformed JSON body BEFORE linting / calling the LLM (not a 500)", async () => {
    const { deps: d, lintManifest, suggest } = deps();
    const res = await handleGovernanceRefresh(sameOriginMalformed(), d);

    assert.equal(res.status, 400);
    // Assert the parse-guard's OWN message, not just any 400 — so this can't be
    // silently satisfied by guardManifestBody 400ing an undefined body instead.
    assert.match((await res.json()).error, /valid json/i);
    assert.equal(lintManifest.mock.calls.length, 0);
    assert.equal(suggest.mock.calls.length, 0);
  });

  it("400s a null JSON body instead of throwing to a 500", async () => {
    const { deps: d } = deps();
    assert.equal(
      (await handleGovernanceRefresh(sameOriginPost(null), d)).status,
      400,
    );
  });

  it("400s an object-valued manifestYaml (would slip past the size guard)", async () => {
    const { deps: d } = deps();
    const res = await handleGovernanceRefresh(
      sameOriginPost({ manifestYaml: { nested: true } }),
      d,
    );
    assert.equal(res.status, 400);
  });

  it("400s an over-large openFileContent BEFORE linting / calling the LLM", async () => {
    const { deps: d, lintManifest, suggest } = deps();
    const res = await handleGovernanceRefresh(
      sameOriginPost({
        manifestYaml: "bounded_contexts: []",
        openFileContent: "a".repeat(MAX_OPEN_FILE_CONTENT_CHARS + 1),
      }),
      d,
    );

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /too large/i);
    assert.equal(lintManifest.mock.calls.length, 0);
    assert.equal(suggest.mock.calls.length, 0);
  });

  it("400s a non-string openFileContent BEFORE linting / calling the LLM", async () => {
    const { deps: d, lintManifest, suggest } = deps();
    const res = await handleGovernanceRefresh(
      sameOriginPost({
        manifestYaml: "bounded_contexts: []",
        openFileContent: { not: "a string" },
      }),
      d,
    );

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /must be a string/i);
    assert.equal(lintManifest.mock.calls.length, 0);
    assert.equal(suggest.mock.calls.length, 0);
  });
});
