import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { GET } from "../route";
import { closePlatformStore, getPlatformStore } from "../../../../lib/platform";

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

describe("GET /api/orgs — membership list (H1.5)", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a session", async () => {
    signedInAs(null);
    const res = await GET(new NextRequest("http://localhost/api/orgs"));
    assert.equal(res.status, 401);
  });

  it("returns the caller's memberships without per-org fan-out", async () => {
    const store = getPlatformStore();
    const acme = await store.orgs.createOrg({
      slug: "acme",
      name: "Acme",
      createdBy: "user-1",
    });
    await store.orgs.addMember(acme.id, "user-1", "owner");
    const other = await store.orgs.createOrg({
      slug: "other",
      name: "Other",
      createdBy: "user-2",
    });
    await store.orgs.addMember(other.id, "user-2", "owner");

    const getOrg = vi.spyOn(store.orgs, "getOrg");
    const memberRole = vi.spyOn(store.orgs, "memberRole");
    const listIds = vi.spyOn(store.orgs, "listOrgIdsForUser");

    signedInAs("user-1");
    const res = await GET(new NextRequest("http://localhost/api/orgs"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      orgs: Array<{ id: string; slug: string; name: string; role: string }>;
    };
    assert.deepEqual(body.orgs, [
      { id: acme.id, slug: "acme", name: "Acme", role: "owner" },
    ]);
    assert.equal(
      getOrg.mock.calls.length,
      0,
      "must not look up each org after listing ids",
    );
    assert.equal(
      memberRole.mock.calls.length,
      0,
      "must not look up each role after listing ids",
    );
    assert.equal(
      listIds.mock.calls.length,
      0,
      "must not list ids then fan out",
    );
  });
});
