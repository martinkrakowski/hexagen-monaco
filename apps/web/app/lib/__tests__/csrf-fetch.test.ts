import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import { fetchWithCsrf } from "../csrf-fetch";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../../../lib/csrf";

function clearCsrfCookie(): void {
  document.cookie = `${CSRF_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("D-H7 — fetchWithCsrf (the one client-side mutation helper)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    clearCsrfCookie();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCsrfCookie();
  });

  it("attaches the header from the cookie on mutations", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok-123; path=/`;
    fetchMock.mockResolvedValue(json(200, { ok: true }));

    const res = await fetchWithCsrf("/api/orgs/o-1", { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(fetchMock.mock.calls.length, 1);
    const init = fetchMock.mock.calls[0][1];
    assert.equal(new Headers(init?.headers).get(CSRF_HEADER_NAME), "tok-123");
  });

  it("leaves GET alone — no header, no cookie read", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok-123; path=/`;
    fetchMock.mockResolvedValue(json(200, {}));

    await fetchWithCsrf("/api/projects");
    const init = fetchMock.mock.calls[0][1];
    assert.equal(new Headers(init?.headers).get(CSRF_HEADER_NAME), null);
  });

  it("recovers from a csrf 403 by bootstrapping a token and retrying exactly once", async () => {
    // No cookie yet: first attempt is denied with the DISTINCT code, the
    // helper mints a token via GET /api/csrf, retries once, succeeds.
    fetchMock
      .mockResolvedValueOnce(
        json(403, { error: "csrf", message: "denied", statusCode: 403 }),
      )
      .mockResolvedValueOnce(json(200, { token: "fresh-tok" }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    const res = await fetchWithCsrf("/api/projects", { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(fetchMock.mock.calls.length, 3);
    assert.equal(fetchMock.mock.calls[1][0], "/api/csrf");
    const retryInit = fetchMock.mock.calls[2][1];
    assert.equal(
      new Headers(retryInit?.headers).get(CSRF_HEADER_NAME),
      "fresh-tok",
    );
  });

  it("retries at most once: a second csrf 403 is returned, not looped on", async () => {
    fetchMock
      .mockResolvedValueOnce(json(403, { error: "csrf", statusCode: 403 }))
      .mockResolvedValueOnce(json(200, { token: "fresh-tok" }))
      .mockResolvedValueOnce(json(403, { error: "csrf", statusCode: 403 }));

    const res = await fetchWithCsrf("/api/projects", { method: "POST" });
    assert.equal(res.status, 403);
    assert.equal(fetchMock.mock.calls.length, 3, "no second bootstrap");
  });

  it("a NON-csrf 403 (authz denial) is returned untouched with no retry", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok-123; path=/`;
    fetchMock.mockResolvedValue(
      json(403, { error: "forbidden", message: "owner only", statusCode: 403 }),
    );

    const res = await fetchWithCsrf("/api/orgs/o-1", { method: "DELETE" });
    assert.equal(res.status, 403);
    assert.equal(
      fetchMock.mock.calls.length,
      1,
      "role denials must not trigger the bootstrap path",
    );
    // The body is still readable by the caller (the helper only ever reads a
    // CLONE while sniffing for the csrf code).
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "forbidden");
  });

  it("a mutating Request OBJECT gets the header — method is not read from init alone", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok-123; path=/`;
    fetchMock.mockResolvedValue(json(200, { ok: true }));

    await fetchWithCsrf(
      new Request("http://localhost/api/orgs", { method: "POST" }),
    );
    assert.equal(fetchMock.mock.calls.length, 1);
    const init = fetchMock.mock.calls[0][1];
    assert.equal(
      new Headers(init?.headers).get(CSRF_HEADER_NAME),
      "tok-123",
      "a POST carried by the Request must be treated as a mutation",
    );
  });

  it("PARALLEL denied mutations share ONE bootstrap — the cookie is not rotated per caller", async () => {
    // Promise.all call sites (useGovernanceData fires three POSTs) must not
    // each mint a token: every mint rotates the shared cookie and a retry
    // holding an older token then fails terminally.
    fetchMock.mockImplementation(async (input, init) => {
      if (input === "/api/csrf") return json(200, { token: "fresh-tok" });
      const sent = new Headers(init?.headers).get(CSRF_HEADER_NAME);
      if (sent === "fresh-tok") return json(200, { ok: true });
      return json(403, { error: "csrf", statusCode: 403 });
    });

    const results = await Promise.all([
      fetchWithCsrf("/api/a", { method: "POST" }),
      fetchWithCsrf("/api/b", { method: "POST" }),
      fetchWithCsrf("/api/c", { method: "POST" }),
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      [200, 200, 200],
    );
    const bootstraps = fetchMock.mock.calls.filter(
      (c) => c[0] === "/api/csrf",
    ).length;
    assert.equal(bootstraps, 1, "all three recoveries must share one mint");
  });
});
