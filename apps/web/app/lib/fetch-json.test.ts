import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import { parseNoticeCountHeaders, postJson, postForBlob } from "./fetch-json";

// The postJson/postForBlob suites stub the fetch global per-test; always
// restore so the parseNoticeCountHeaders suite (and other files in the
// worker) never see a leaked stub.
afterEach(() => {
  vi.unstubAllGlobals();
});

// Minimal Response stand-in: the helpers only touch ok/status/json/blob/
// headers, and `fetch` is stubbed anyway, so a plain object avoids depending
// on a full Response constructor in the jsdom environment.
interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  blob?: () => Promise<Blob>;
  headers?: Headers;
}

function stubFetch(init: FakeResponseInit): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: init.json ?? (() => Promise.resolve({})),
      blob: init.blob ?? (() => Promise.resolve(new Blob())),
      headers: init.headers ?? new Headers(),
    }),
  );
}

describe("parseNoticeCountHeaders", () => {
  it("reads warning + error counts from the sideband headers", () => {
    const headers = new Headers({
      "x-hexagen-addon-warnings": "3",
      "x-hexagen-addon-errors": "2",
    });
    assert.deepEqual(parseNoticeCountHeaders(headers), {
      warnings: 3,
      errors: 2,
    });
  });

  it("is header-name case-insensitive (the route sets X-Hexagen-…)", () => {
    const headers = new Headers({ "X-Hexagen-Addon-Errors": "1" });
    assert.deepEqual(parseNoticeCountHeaders(headers), {
      warnings: 0,
      errors: 1,
    });
  });

  it("returns undefined when both headers are absent (e.g. stripped by a proxy)", () => {
    assert.equal(parseNoticeCountHeaders(new Headers()), undefined);
  });

  it("treats non-numeric or non-positive values as 0 (defensive)", () => {
    const headers = new Headers({
      "x-hexagen-addon-warnings": "not-a-number",
      "x-hexagen-addon-errors": "-5",
    });
    assert.equal(parseNoticeCountHeaders(headers), undefined);
  });

  it("floors fractional counts", () => {
    const headers = new Headers({ "x-hexagen-addon-warnings": "2.9" });
    assert.deepEqual(parseNoticeCountHeaders(headers), {
      warnings: 2,
      errors: 0,
    });
  });
});

describe("postJson", () => {
  it("carries the machine-readable code from an { error, code } body", async () => {
    stubFetch({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          error: "Reconnect GitHub to grant workflow permission, then retry.",
          code: "workflow_scope_required",
        }),
    });
    assert.deepEqual(await postJson("/api/export/github", {}), {
      kind: "http-error",
      status: 403,
      message: "Reconnect GitHub to grant workflow permission, then retry.",
      code: "workflow_scope_required",
    });
  });

  it("leaves code undefined when the error body has none", async () => {
    stubFetch({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "boom" }),
    });
    assert.deepEqual(await postJson("/x", {}), {
      kind: "http-error",
      status: 500,
      message: "boom",
      code: undefined,
    });
  });

  it("drops a non-string code (defensive against malformed bodies)", async () => {
    stubFetch({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "bad request", code: 42 }),
    });
    assert.deepEqual(await postJson("/x", {}), {
      kind: "http-error",
      status: 400,
      message: "bad request",
      code: undefined,
    });
  });

  it("still returns success for ok responses", async () => {
    stubFetch({ json: () => Promise.resolve({ hello: "world" }) });
    assert.deepEqual(await postJson("/x", {}), {
      kind: "success",
      data: { hello: "world" },
    });
  });

  it("classifies an unparseable error body as parse-error, not http-error (deliberate ordering — see module doc)", async () => {
    stubFetch({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    });
    assert.deepEqual(await postJson("/x", {}), {
      kind: "parse-error",
      message: "Unexpected token <",
    });
  });
});

describe("postForBlob", () => {
  it("carries the machine-readable code from a parseable error body", async () => {
    stubFetch({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: "GitHub session expired.",
          code: "reauth_required",
        }),
    });
    assert.deepEqual(await postForBlob("/api/export/zip", {}), {
      kind: "http-error",
      status: 401,
      message: "GitHub session expired.",
      code: "reauth_required",
    });
  });

  it("returns http-error with the fallback message and no code when the error body is unparseable", async () => {
    stubFetch({
      ok: false,
      status: 500,
      json: () => Promise.reject(new SyntaxError("Unexpected end of input")),
    });
    assert.deepEqual(await postForBlob("/x", {}), {
      kind: "http-error",
      status: 500,
      message: "Request failed (500)",
    });
  });
});
