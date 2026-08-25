import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Spread the real module and override only `getToken`: a bare factory drops
// `encode`/`decode`, which the module also exports.
vi.mock("next-auth/jwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/jwt")>()),
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { POST as createOrg } from "../route";
import { getPlatformStore, closePlatformStore } from "../../../../lib/platform";

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

function postOrg(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/orgs", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/**
 * `POST /api/orgs` (H1.1). Until this route existed, the org half of the
 * ownership model was unreachable: `owner_id` accepted an org UUID and
 * `resolveProjectAccess` granted on membership, but nothing produced an org.
 */
describe("H1.1 — POST /api/orgs", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a session", async () => {
    signedInAs(null);
    const res = await createOrg(postOrg({ slug: "acme", name: "Acme" }));
    assert.equal(res.status, 401);
  });

  it("201 makes the caller the org's owner, and only for that caller", async () => {
    signedInAs("founder");
    const res = await createOrg(postOrg({ slug: "acme", name: "Acme" }));
    assert.equal(res.status, 201);

    const { org } = (await res.json()) as { org: { id: string; slug: string } };
    assert.equal(org.slug, "acme");

    const store = getPlatformStore();
    assert.equal(await store.orgs.memberRole(org.id, "founder"), "owner");
    assert.deepEqual(await store.orgs.listOrgIdsForUser("founder"), [org.id]);
    // A different user is not a member of an org they did not create.
    assert.deepEqual(await store.orgs.listOrgIdsForUser("stranger"), []);
  });

  it("409 on a duplicate slug", async () => {
    signedInAs("founder");
    assert.equal(
      (await createOrg(postOrg({ slug: "acme", name: "Acme" }))).status,
      201,
      "the first create must succeed, or the 409 below proves nothing",
    );

    signedInAs("other");
    const res = await createOrg(postOrg({ slug: "acme", name: "Acme Two" }));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "conflict");
  });

  for (const [label, slug] of [
    ["a slash (would break @org/team handles)", "acme/platform"],
    ["an at-sign (would break @org handles)", "acme@corp"],
    ["uppercase", "Acme"],
    ["empty", ""],
  ] as const) {
    it(`400 when the slug contains ${label}`, async () => {
      signedInAs("founder");
      const res = await createOrg(postOrg({ slug, name: "Acme" }));
      assert.equal(res.status, 400, `slug '${slug}' must be rejected`);
    });
  }

  it("400 without a name", async () => {
    signedInAs("founder");
    const res = await createOrg(postOrg({ slug: "acme", name: "" }));
    assert.equal(res.status, 400);
  });
});
