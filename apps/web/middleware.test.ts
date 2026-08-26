import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { apiAuthDenial, requiresAuth } from "./middleware";

/**
 * REVERSAL, RECORDED — 2026-08-25.
 *
 * The previous version of this file was a guardrail asserting that
 * `/projects` and the generate APIs stayed auth-free (the anonymous free
 * tier, quota-D2 / H1.7). That policy was reversed by owner decision on
 * 2026-08-25: "All plans including the free tier should require a
 * signup/account" (D-U1, docs/planning/2026-08-25-login-onboarding-ui-plan.md).
 *
 * This file is now the guardrail for the NEW policy: deny-by-default with an
 * exact allowlist. If an entry appears in the allowlist that this test does
 * not pin, or a pinned path stops being gated, that is the same class of
 * silent policy drift the old file existed to stop.
 */
describe("auth middleware — deny-by-default gate (D-U1)", () => {
  it("gates every page and API by default — the old anonymous surfaces included", () => {
    for (const pathname of [
      "/projects",
      "/projects/new",
      "/projects/new/import",
      "/projects/history",
      "/wizard/1",
      "/account",
      "/billing",
      "/architecture-viewer",
      "/api/projects",
      "/api/runs",
      "/api/orgs",
      // Previously anonymous by design (quota-D2). Now gated IN FRONT —
      // ADR-0063's frozen files are untouched.
      "/api/manifest/generate",
      "/api/manifest/generate/stage",
      "/api/llm/chat",
      "/api/free-tier/quota",
      "/api/projects/scan",
    ]) {
      assert.equal(requiresAuth(pathname), true, pathname);
    }
  });

  it("allowlist is exact: login, legacy auth redirect, NextAuth, csrf", () => {
    for (const pathname of [
      "/projects/new/login",
      "/auth/signin",
      "/api/auth/providers", // also the deploy healthcheck target
      "/api/auth/callback/github",
      "/api/csrf",
    ]) {
      assert.equal(requiresAuth(pathname), false, pathname);
    }
  });

  it("allowlist prefixes do not swallow siblings", () => {
    // "/projects/new/login" must not exempt "/projects/new" or a
    // hypothetical "/projects/new/login-history"-style sibling.
    assert.equal(requiresAuth("/projects/new"), true);
    assert.equal(requiresAuth("/projects/new/loginx"), true);
    assert.equal(requiresAuth("/api/csrfx"), true);
  });

  it("the API denial mirrors requirePersistenceOwner's body exactly", async () => {
    // The client's isUnauthenticatedPersistenceError string-matches
    // "Sign in required" — the two literals must not drift apart.
    const denial = apiAuthDenial();
    assert.equal(denial.status, 401);
    assert.equal(denial.headers.get("cache-control"), "no-store");
    const body = (await denial.json()) as {
      error: string;
      message: string;
      statusCode: number;
    };
    assert.deepEqual(body, {
      error: "unauthorized",
      message: "Sign in required",
      statusCode: 401,
    });
  });
});

describe("middleware routing of unauthenticated traffic", () => {
  it("pages redirect to the in-shell login with the full deep link", async () => {
    const { middleware } = await import("./middleware");
    const response = await middleware(
      new NextRequest("http://localhost/projects/history?range=30d"),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.pathname, "/projects/new/login");
    assert.equal(
      location.searchParams.get("callbackUrl"),
      "/projects/history?range=30d",
    );
  });

  it("APIs get the 401 JSON, never a redirect", async () => {
    const { middleware } = await import("./middleware");
    const response = await middleware(
      new NextRequest("http://localhost/api/manifest/generate", {
        method: "POST",
      }),
    );
    assert.equal(response.status, 401);
  });
});
