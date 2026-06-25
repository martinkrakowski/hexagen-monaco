import { describe, it } from "vitest";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { resolveAnonSession, ANON_SESSION_COOKIE } from "../anon-session";

function reqWithCookie(value?: string): NextRequest {
  const headers = new Headers();
  if (value !== undefined) {
    headers.set("cookie", `${ANON_SESSION_COOKIE}=${value}`);
  }
  return new NextRequest("http://localhost/", { headers });
}

const VALID_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("resolveAnonSession", () => {
  it("reuses a well-formed UUID cookie without re-issuing it", () => {
    const s = resolveAnonSession(reqWithCookie(VALID_UUID));
    assert.strictEqual(s.sessionId, VALID_UUID);
    assert.strictEqual(s.setCookie, undefined);
  });

  it("mints a fresh UUID (with a Set-Cookie) when no cookie is present", () => {
    const s = resolveAnonSession(reqWithCookie());
    assert.match(s.sessionId, /^[0-9a-f-]{36}$/i);
    assert.ok(s.setCookie?.includes(`${ANON_SESSION_COOKIE}=${s.sessionId}`));
  });

  it("rejects a non-UUID cookie and mints a fresh one", () => {
    const s = resolveAnonSession(reqWithCookie("not-a-uuid"));
    assert.notStrictEqual(s.sessionId, "not-a-uuid");
    assert.match(s.sessionId, /^[0-9a-f-]{36}$/i);
    assert.ok(s.setCookie, "issues a fresh cookie");
  });

  it("rejects an oversized cookie value — bounds the PK to 36 chars", () => {
    const huge = "a".repeat(5000);
    const s = resolveAnonSession(reqWithCookie(huge));
    assert.notStrictEqual(s.sessionId, huge);
    assert.strictEqual(s.sessionId.length, 36);
  });
});
