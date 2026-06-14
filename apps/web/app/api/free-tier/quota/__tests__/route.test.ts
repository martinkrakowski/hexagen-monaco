import { describe, it } from "node:test";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { ANON_SESSION_COOKIE } from "../../../../../lib/anon-session";
import { getQuotaStore, QUOTA_LIMITS } from "../../../../../lib/quota-store";

function get(sid?: string): NextRequest {
  const headers = new Headers();
  if (sid) headers.set("cookie", `${ANON_SESSION_COOKIE}=${sid}`);
  return new NextRequest("http://localhost/api/free-tier/quota", { headers });
}

describe("GET /api/free-tier/quota", () => {
  it("returns a full snapshot and mints a cookie for a fresh visitor", async () => {
    const res = await GET(get());
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get("set-cookie")?.includes(ANON_SESSION_COOKIE));
    const body = await res.json();
    assert.strictEqual(body.generation.used, 0);
    assert.strictEqual(body.generation.limit, QUOTA_LIMITS.generation);
    assert.strictEqual(body.generation.remaining, QUOTA_LIMITS.generation);
    assert.strictEqual(body.chat.limit, QUOTA_LIMITS.chat);
  });

  it("reflects consumed quota for a known session without consuming again", async () => {
    const sid = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    const store = getQuotaStore();
    store.consume(sid, "generation");
    store.consume(sid, "generation");

    const res = await GET(get(sid));
    assert.strictEqual(res.headers.get("set-cookie"), null); // known session
    const body = await res.json();
    assert.strictEqual(body.generation.used, 2);
    assert.strictEqual(body.generation.remaining, QUOTA_LIMITS.generation - 2);

    // A second read must not have consumed anything.
    const again = await GET(get(sid));
    assert.strictEqual((await again.json()).generation.used, 2);
  });
});
