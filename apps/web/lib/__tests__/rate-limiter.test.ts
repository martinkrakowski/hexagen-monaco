import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { checkRateLimit } from "../rate-limiter";

/** All requests here share one IP; only the `identifier` argument differs, so
 * the tests isolate the identifier-keying behavior from IP derivation. */
function req(): NextRequest {
  return new NextRequest("http://localhost/api/x", {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.7" },
  });
}

describe("checkRateLimit", () => {
  it("keys by the explicit identifier, not the shared IP", () => {
    // Budget of 1 per window. Two DIFFERENT principals on the SAME IP must each
    // get their own budget — proving the identifier overrides IP derivation.
    const a1 = checkRateLimit(req(), 1, 60_000, "user-A");
    const a2 = checkRateLimit(req(), 1, 60_000, "user-A");
    const b1 = checkRateLimit(req(), 1, 60_000, "user-B");

    assert.equal(a1.allowed, true, "user-A first call allowed");
    assert.equal(a2.allowed, false, "user-A second call blocked (own budget)");
    assert.equal(
      b1.allowed,
      true,
      "user-B allowed on the same IP — separate budget",
    );
  });

  it("blocks the same identifier once its window budget is spent", () => {
    const r = req();
    assert.equal(checkRateLimit(r, 2, 60_000, "user-C").allowed, true);
    assert.equal(checkRateLimit(r, 2, 60_000, "user-C").allowed, true);
    const third = checkRateLimit(r, 2, 60_000, "user-C");
    assert.equal(third.allowed, false);
    assert.ok((third.retryAfter ?? 0) > 0);
  });

  it("isolates budgets across keyPrefixes for the same identifier", () => {
    // The same principal used by two different routes must NOT share one bucket:
    // a `keyPrefix` gives each route its own namespace. Budget of 1 per window.
    const chat1 = checkRateLimit(req(), 1, 60_000, "user-D", "chat");
    const chat2 = checkRateLimit(req(), 1, 60_000, "user-D", "chat");
    const extract1 = checkRateLimit(req(), 1, 60_000, "user-D", "extract");

    assert.equal(chat1.allowed, true, "chat first call allowed");
    assert.equal(chat2.allowed, false, "chat budget spent");
    assert.equal(
      extract1.allowed,
      true,
      "extract has its own budget for the same principal",
    );
  });

  it("keeps a prefixed IP budget independent of the unprefixed one", () => {
    // guardMutation namespaces by "mutation"; the manifest routes key by raw IP.
    // Same IP, no identifier: the "mutation" namespace must not draw down the
    // raw-IP budget the manifest routes use.
    const headers = { "x-forwarded-for": "203.0.113.200" };
    const mkReq = () =>
      new NextRequest("http://localhost/api/x", { method: "POST", headers });

    const raw = checkRateLimit(mkReq(), 1, 60_000);
    const mutation = checkRateLimit(mkReq(), 1, 60_000, undefined, "mutation");

    assert.equal(raw.allowed, true, "raw-IP first call allowed");
    assert.equal(
      mutation.allowed,
      true,
      "mutation namespace on the same IP has its own budget",
    );
  });

  it("falls back to IP derivation when no identifier is given", () => {
    // No identifier: both calls key off the same forwarded IP → one budget.
    const first = checkRateLimit(
      new NextRequest("http://localhost/api/x", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.99" },
      }),
      1,
      60_000,
    );
    const second = checkRateLimit(
      new NextRequest("http://localhost/api/x", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.99" },
      }),
      1,
      60_000,
    );
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, false);
  });
});
