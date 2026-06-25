import { describe, it } from "vitest";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { enforceDailyQuota } from "../enforce-quota";
import {
  createQuotaStore,
  QUOTA_LIMITS,
  type QuotaStore,
} from "../quota-store";
import { ANON_SESSION_COOKIE } from "../anon-session";

function req(sid?: string): NextRequest {
  const headers = new Headers();
  if (sid) headers.set("cookie", `${ANON_SESSION_COOKIE}=${sid}`);
  return new NextRequest("http://localhost/api/manifest/generate", { headers });
}

// resolveAnonSession now rejects non-UUID cookies, so tests must use a real
// session id for quota to accumulate across requests.
const SID = "11111111-1111-4111-8111-111111111111";

describe("enforceDailyQuota", () => {
  it("mints an HttpOnly session cookie on the first (cookieless) request", () => {
    const store = createQuotaStore(":memory:");
    const gate = enforceDailyQuota(req(), "generation", store);
    assert.strictEqual(gate.ok, true);
    const setCookie = gate.headers["Set-Cookie"];
    assert.ok(setCookie?.includes(`${ANON_SESSION_COOKIE}=`), "issues hxg_sid");
    assert.match(setCookie!, /HttpOnly/);
    assert.match(setCookie!, /SameSite=Lax/);
    store.close();
  });

  it("reuses an existing session — no new Set-Cookie", () => {
    const store = createQuotaStore(":memory:");
    const gate = enforceDailyQuota(req(SID), "generation", store);
    assert.strictEqual(gate.ok, true);
    assert.strictEqual(gate.headers["Set-Cookie"], undefined);
    store.close();
  });

  it("returns a 429 (with Retry-After + kind) once the daily cap is hit", async () => {
    const store = createQuotaStore(":memory:");
    for (let i = 0; i < QUOTA_LIMITS.generation; i++) {
      assert.strictEqual(
        enforceDailyQuota(req(SID), "generation", store).ok,
        true,
      );
    }
    const gate = enforceDailyQuota(req(SID), "generation", store);
    assert.strictEqual(gate.ok, false);
    if (gate.ok) throw new Error("unreachable"); // narrow the union
    assert.strictEqual(gate.response.status, 429);
    assert.ok(gate.response.headers.get("Retry-After"));
    const body = (await gate.response.json()) as {
      kind: string;
      remaining: number;
      success: boolean;
    };
    assert.strictEqual(body.kind, "generation");
    assert.strictEqual(body.remaining, 0);
    assert.strictEqual(body.success, false);
    store.close();
  });

  it("meters chat and generation independently for one session", () => {
    const store = createQuotaStore(":memory:");
    for (let i = 0; i < QUOTA_LIMITS.generation; i++) {
      enforceDailyQuota(req(SID), "generation", store);
    }
    assert.strictEqual(
      enforceDailyQuota(req(SID), "generation", store).ok,
      false,
    );
    assert.strictEqual(enforceDailyQuota(req(SID), "chat", store).ok, true);
    store.close();
  });

  it("fails open (allows the request) when the store throws", () => {
    const broken = {
      consume() {
        throw new Error("db unavailable");
      },
    } as unknown as QuotaStore;
    const gate = enforceDailyQuota(req(SID), "generation", broken);
    assert.strictEqual(gate.ok, true);
  });
});
