import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { guardApiCsrf, isCsrfEnforcedApiPath } from "./middleware";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./lib/csrf";

const SESSION = "next-auth.session-token=jwt-value";
const TOKEN = "a".repeat(64);

function request(opts: {
  path?: string;
  method?: string;
  cookies?: string[];
  header?: string;
}): NextRequest {
  const headers = new Headers();
  if (opts.cookies?.length) headers.set("cookie", opts.cookies.join("; "));
  if (opts.header !== undefined) headers.set(CSRF_HEADER_NAME, opts.header);
  return new NextRequest(`http://localhost${opts.path ?? "/api/orgs/o-1"}`, {
    method: opts.method ?? "DELETE",
    headers,
  });
}

describe("D-H7 — guardApiCsrf (double-submit, enforced in middleware only)", () => {
  it("403 when a session-cookie mutation carries no CSRF header", async () => {
    const denied = guardApiCsrf(
      request({ cookies: [SESSION, `${CSRF_COOKIE_NAME}=${TOKEN}`] }),
    );
    assert.ok(denied, "must deny");
    assert.equal(denied.status, 403);
    const body = (await denied.json()) as { error: string };
    assert.equal(body.error, "csrf", "distinct code so clients can recover");
    assert.equal(
      denied.headers.get("cache-control"),
      "no-store",
      "a cached denial would keep denying after the client bootstraps a token",
    );
  });

  it("403 when the header does not match the cookie", () => {
    const denied = guardApiCsrf(
      request({
        cookies: [SESSION, `${CSRF_COOKIE_NAME}=${TOKEN}`],
        header: "b".repeat(64),
      }),
    );
    assert.equal(denied?.status, 403);
  });

  it("403 when the session cookie is present but the CSRF cookie is absent", () => {
    // The forged-request shape: the browser attaches the session cookie
    // automatically, the attacker's page cannot read or mint our cookie.
    const denied = guardApiCsrf(request({ cookies: [SESSION], header: TOKEN }));
    assert.equal(denied?.status, 403);
  });

  it("passes through (to authz) when cookie and header match", () => {
    const verdict = guardApiCsrf(
      request({
        cookies: [SESSION, `${CSRF_COOKIE_NAME}=${TOKEN}`],
        header: TOKEN,
      }),
    );
    assert.equal(verdict, null);
  });

  it("cookie-less callers are untouched — the CI/wedge/curl contract", () => {
    // No cookies at all: nothing for a cross-site page to ride on, and the
    // wedge/CI callers must keep working with zero CSRF ceremony.
    assert.equal(guardApiCsrf(request({ cookies: [] })), null);
    // __Secure- variant IS a session cookie and must not slip through.
    const denied = guardApiCsrf(
      request({ cookies: ["__Secure-next-auth.session-token=jwt"] }),
    );
    assert.equal(denied?.status, 403);
  });

  it("non-mutating methods and non-enforced paths are untouched", () => {
    assert.equal(
      guardApiCsrf(request({ method: "GET", cookies: [SESSION] })),
      null,
    );
    assert.equal(
      guardApiCsrf(
        request({ path: "/api/auth/callback/github", cookies: [SESSION] }),
      ),
      null,
      "NextAuth's own surface carries NextAuth's own CSRF protection",
    );
    assert.equal(
      guardApiCsrf(request({ path: "/projects", cookies: [SESSION] })),
      null,
      "non-API paths are not this gate's business",
    );
  });

  it("path predicate is uniform over /api, with only the two exemptions", () => {
    for (const path of [
      "/api/projects",
      "/api/projects/p-1",
      "/api/projects/scan",
      "/api/projects/bootstrap",
      "/api/tenants/t-1/projects/p-1",
      "/api/orgs",
      "/api/orgs/o-1",
      "/api/orgs/o-1/teams/t-1/members",
      "/api/runs",
      "/api/byok/keys",
      "/api/account/delete",
      // Anonymous-quota families TOO: uniformity means no per-family
      // allowlist to keep correct as routes are added. A session cookie on
      // these authorizes nothing, but every mutating client fetch goes
      // through fetchWithCsrf, so signed-in users carry the header anyway.
      "/api/manifest/generate",
      "/api/governance/chat",
      "/api/llm/chat",
      "/api/generate",
      "/api/architecture/modify/accept",
    ]) {
      assert.equal(isCsrfEnforcedApiPath(path), true, path);
    }
    for (const path of [
      "/api/auth/session",
      "/api/auth/callback/github",
      "/api/csrf",
      "/projects",
      "/apixyz",
    ]) {
      assert.equal(isCsrfEnforcedApiPath(path), false, path);
    }
  });
});
