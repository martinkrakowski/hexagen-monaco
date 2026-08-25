import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { GET, POST } from "../route";
import { closePlatformStore, getPlatformStore } from "../../../../lib/platform";

const telemetry = {
  stage: 1,
  label: "Domain Extraction",
  durationMs: 800,
  usedLLM: true,
  retryCount: 0,
  inputTokensEstimate: 200,
  outputTokensActual: 80,
  servedFromCache: false,
  summary: "3 contexts",
  modelName: "gpt-4o",
};

const ORG = "org-acme";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function get(tenantId?: string): Promise<Response> {
  const url = tenantId
    ? `http://localhost/api/runs?tenantId=${tenantId}`
    : "http://localhost/api/runs";
  return GET(new NextRequest(url));
}

async function eventsOf(response: Response): Promise<unknown[]> {
  const body = (await response.json()) as { events: unknown[] };
  return body.events;
}

/**
 * H1.5 — run history follows the tenant, not the poster.
 *
 * Every refusal here is checked against a tenant that provably EXISTS with a
 * real member, so a 403 is an authorisation decision rather than an empty
 * lookup that would refuse anything.
 */
describe("/api/runs — tenant-scoped history (H1.5)", () => {
  beforeEach(async () => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
    // Wave-3 FK: org_members.org_id → orgs.id, so the org row must exist
    // before membership. MEMBER genuinely belongs to it.
    const store = getPlatformStore();
    await store.orgs.createOrg({
      id: ORG,
      slug: "acme",
      name: "Acme",
      createdBy: MEMBER,
    });
    await store.orgs.addMember(ORG, MEMBER, "member");
  });
  afterEach(() => closePlatformStore());

  it("a run posted for an org lands under the ORG, and not under the poster", async () => {
    signedInAs(MEMBER);
    const created = await post({ runId: "run-1", telemetry, tenantId: ORG });
    assert.equal(created.status, 201);

    // The org has it...
    const orgEvents = await eventsOf(await get(ORG));
    assert.equal(orgEvents.length, 1, "the org's history must hold the run");

    // ...and the poster's personal history does NOT. Without this the test
    // would pass if the row were written to both.
    const personalEvents = await eventsOf(await get());
    assert.equal(
      personalEvents.length,
      0,
      "the run must not also land in the poster's personal history",
    );
  });

  it("an org member reads the org's history; an outsider gets 403", async () => {
    signedInAs(MEMBER);
    await post({ runId: "run-1", telemetry, tenantId: ORG });

    const memberRead = await get(ORG);
    assert.equal(memberRead.status, 200);
    const events = await eventsOf(memberRead);
    assert.ok(
      events.length > 0,
      "the member must see a non-empty history, or the 403 below proves nothing",
    );

    signedInAs(OUTSIDER);
    const outsiderRead = await get(ORG);
    assert.equal(
      outsiderRead.status,
      403,
      "a non-member must be refused a populated org history",
    );
  });

  it("membership removed mid-test: the next read is 403 (resolved per request)", async () => {
    signedInAs(MEMBER);
    await post({ runId: "run-1", telemetry, tenantId: ORG });
    assert.equal((await get(ORG)).status, 200, "allowed while a member");

    await getPlatformStore().orgs.removeMember(ORG, MEMBER);

    assert.equal(
      (await get(ORG)).status,
      403,
      "removal must take effect on the very next request",
    );
  });

  it("an outsider cannot POST into an org's history", async () => {
    signedInAs(OUTSIDER);
    const created = await post({ runId: "run-x", telemetry, tenantId: ORG });
    assert.equal(created.status, 403);

    // And nothing was written: the org's history is still empty.
    signedInAs(MEMBER);
    assert.equal((await eventsOf(await get(ORG))).length, 0);
  });

  it("the personal path is unchanged when no tenant is supplied", async () => {
    signedInAs(MEMBER);
    const created = await post({ runId: "run-personal", telemetry });
    assert.equal(created.status, 201);

    const personal = await get();
    assert.equal(personal.status, 200);
    assert.equal((await eventsOf(personal)).length, 1);

    // The org saw nothing of it.
    assert.equal((await eventsOf(await get(ORG))).length, 0);
  });

  it("an empty or whitespace tenantId query param is personal, not a tenant", async () => {
    signedInAs(MEMBER);
    await post({ runId: "run-org", telemetry, tenantId: ORG });
    await post({ runId: "run-me", telemetry });

    const empty = await GET(
      new NextRequest("http://localhost/api/runs?tenantId="),
    );
    const whitespace = await GET(
      new NextRequest("http://localhost/api/runs?tenantId=%20"),
    );

    assert.equal(empty.status, 200, "empty tenantId must not 403");
    assert.equal(whitespace.status, 200, "whitespace tenantId must not 403");
    assert.equal(
      (await eventsOf(empty)).length,
      1,
      "empty tenantId is personal history (one personal run), not the org's",
    );
    assert.equal(
      (await eventsOf(whitespace)).length,
      1,
      "whitespace tenantId is personal history, not the org's",
    );
  });

  it("a whitespace-only tenantId in the POST body is rejected, not written personally", async () => {
    signedInAs(MEMBER);
    const created = await post({
      runId: "run-ws",
      telemetry,
      tenantId: "   ",
    });
    assert.equal(created.status, 400);

    assert.equal(
      (await eventsOf(await get())).length,
      0,
      "invalid tenantId must not fall through to the personal owner",
    );
    assert.equal((await eventsOf(await get(ORG))).length, 0);
  });
});
