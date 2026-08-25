import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Spread the real module and override only `getToken`: next-auth/jwt also
// exports `encode` and `decode`, and a double that drops them would make any
// future import of those resolve to undefined at runtime while typechecking
// clean.
vi.mock("next-auth/jwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/jwt")>()),
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { POST as createTeam } from "../[orgId]/teams/route";
import { POST as addMember } from "../[orgId]/teams/[teamId]/members/route";
import { getPlatformStore, closePlatformStore } from "../../../../lib/platform";

const ORG = "org-acme";

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

function postTeam(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/orgs/${ORG}/teams`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function postMember(teamId: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/orgs/${ORG}/teams/${teamId}/members`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

const orgParams = { params: Promise.resolve({ orgId: ORG }) };
const teamParams = (teamId: string) => ({
  params: Promise.resolve({ orgId: ORG, teamId }),
});

/** Seeds the org row plus one membership, and returns the live store. */
async function seedOrg(role: "owner" | "member", userId: string) {
  const store = getPlatformStore();
  await store.orgs.createOrg({
    id: ORG,
    slug: "acme",
    name: "Acme",
    createdBy: "founder",
  });
  await store.orgs.addMember(ORG, userId, role);
  return store;
}

describe("P-A2 — /api/orgs/[orgId]/teams", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("the next-auth/jwt double keeps the module's other exports", async () => {
    // Without this the fix above has nothing proving it. A factory returning
    // only `getToken` typechecks and passes every existing test, and the loss
    // surfaces later as `encode is not a function` in whichever test first
    // needs it.
    const jwt = await import("next-auth/jwt");
    assert.equal(typeof jwt.encode, "function");
    assert.equal(typeof jwt.decode, "function");
    assert.equal(vi.isMockFunction(jwt.getToken), true);
  });

  it("401 without a session", async () => {
    signedInAs(null);
    const res = await createTeam(postTeam({ slug: "p", name: "P" }), orgParams);
    assert.equal(res.status, 401);
  });

  it("403 for a signed-in non-member — and the org exists", async () => {
    const store = await seedOrg("owner", "founder");
    // Non-vacuity: the org is real and has a member, so the 403 is an authz
    // decision rather than an empty lookup.
    assert.ok(await store.orgs.getOrg(ORG));
    assert.equal(await store.orgs.memberRole(ORG, "founder"), "owner");

    signedInAs("outsider");
    const res = await createTeam(
      postTeam({ slug: "platform", name: "Platform" }),
      orgParams,
    );
    assert.equal(res.status, 403);
  });

  it("403 for an org MEMBER: managing teams is owner-only", async () => {
    await seedOrg("member", "dev-1");
    signedInAs("dev-1");
    const res = await createTeam(
      postTeam({ slug: "platform", name: "Platform" }),
      orgParams,
    );
    assert.equal(res.status, 403);
  });

  it("201 for the org owner, and the team is readable", async () => {
    const store = await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await createTeam(
      postTeam({ slug: "platform", name: "Platform" }),
      orgParams,
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as { team: { id: string; slug: string } };
    assert.equal(body.team.slug, "platform");
    assert.ok(await store.teams.getTeam(body.team.id));
  });

  it("rejects a slug that is not handle-safe", async () => {
    await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await createTeam(
      postTeam({ slug: "Not A Slug", name: "X" }),
      orgParams,
    );
    assert.equal(res.status, 400);
  });

  it("409 on a duplicate slug in the same org", async () => {
    await seedOrg("owner", "founder");
    signedInAs("founder");
    await createTeam(postTeam({ slug: "platform", name: "P" }), orgParams);
    const again = await createTeam(
      postTeam({ slug: "platform", name: "P again" }),
      orgParams,
    );
    assert.equal(again.status, 409);
  });

  it("409 when adding a user who is not in the org", async () => {
    const store = await seedOrg("owner", "founder");
    signedInAs("founder");
    const created = await createTeam(
      postTeam({ slug: "platform", name: "P" }),
      orgParams,
    );
    const { team } = (await created.json()) as { team: { id: string } };

    // Non-vacuity: the team exists; only the org membership is missing.
    assert.ok(await store.teams.getTeam(team.id));

    const res = await addMember(
      postMember(team.id, { userId: "stranger" }),
      teamParams(team.id),
    );
    assert.equal(res.status, 409);
    assert.equal(await store.teams.isMember(team.id, "stranger"), false);
  });

  it("201 when adding an org member, and one audit row is written", async () => {
    const store = await seedOrg("owner", "founder");
    await store.orgs.addMember(ORG, "dev-1", "member");
    signedInAs("founder");
    const created = await createTeam(
      postTeam({ slug: "platform", name: "P" }),
      orgParams,
    );
    const { team } = (await created.json()) as { team: { id: string } };

    // The audit assertion is the point of this test's second half: asserting
    // membership alone still passes when the audit write is removed entirely.
    // Count BEFORE, so "exactly one new row" is a delta rather than a total a
    // pre-existing row could satisfy.
    const before = await store.audit.countFor("team.member.add", team.id);

    const res = await addMember(
      postMember(team.id, { userId: "dev-1" }),
      teamParams(team.id),
    );
    assert.equal(res.status, 201);
    assert.equal(await store.teams.isMember(team.id, "dev-1"), true);
    assert.equal(
      (await store.audit.countFor("team.member.add", team.id)) - before,
      1,
      "the membership add must write exactly one team.member.add audit row",
    );
  });

  it("404 for a team id belonging to another org", async () => {
    const store = await seedOrg("owner", "founder");
    const foreign = await store.teams.createTeam({
      orgId: "org-other",
      slug: "platform",
      name: "P",
      createdBy: "someone",
    });
    signedInAs("founder");
    const res = await addMember(
      postMember(foreign.id, { userId: "founder" }),
      teamParams(foreign.id),
    );
    assert.equal(res.status, 404);
  });
});
