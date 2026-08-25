import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Spread the real module and override only `getToken` — see teams-routes.test.
vi.mock("next-auth/jwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth/jwt")>()),
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { POST as addMember } from "../[orgId]/members/route";
import {
  DELETE as removeMember,
  PATCH as changeRole,
} from "../[orgId]/members/[userId]/route";
import { getPlatformStore, closePlatformStore } from "../../../../lib/platform";

const ORG = "org-acme";

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

function postMember(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/orgs/${ORG}/members`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function deleteMember(userId: string): NextRequest {
  return new NextRequest(`http://localhost/api/orgs/${ORG}/members/${userId}`, {
    method: "DELETE",
  });
}

function patchMember(userId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/orgs/${ORG}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const orgParams = { params: Promise.resolve({ orgId: ORG }) };
const memberParams = (userId: string) => ({
  params: Promise.resolve({ orgId: ORG, userId }),
});

/** Seeds the org plus one membership, and returns the live store. */
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

/**
 * A user row, so the handle resolves to an account rather than an invite.
 *
 * `createUser` mints its own id (NextAuth's adapter contract takes
 * `Omit<AdapterUser, "id">`), so the caller must use what comes back rather
 * than a chosen string.
 */
async function seedUser(login: string): Promise<string> {
  const store = getPlatformStore();
  const user = store.auth.createUser({
    name: login,
    email: `${login}@example.test`,
    emailVerified: null,
  } as never);
  await store.auth.setGithubLogin(user.id, login);
  return user.id;
}

describe("H1.2 — POST /api/orgs/[orgId]/members", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a session", async () => {
    signedInAs(null);
    const res = await addMember(
      postMember({ githubLogin: "ada", role: "member" }),
      orgParams,
    );
    assert.equal(res.status, 401);
  });

  it("403 for a signed-in non-member — and the org exists", async () => {
    const store = await seedOrg("owner", "founder");
    assert.ok(await store.orgs.getOrg(ORG));

    signedInAs("outsider");
    const res = await addMember(
      postMember({ githubLogin: "ada", role: "member" }),
      orgParams,
    );
    assert.equal(res.status, 403);
  });

  it("403 for an org MEMBER: managing membership is owner-only", async () => {
    await seedOrg("member", "dev-1");
    signedInAs("dev-1");
    const res = await addMember(
      postMember({ githubLogin: "ada", role: "member" }),
      orgParams,
    );
    assert.equal(res.status, 403);
  });

  it("400 on a role outside the two H1.3 roles", async () => {
    await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await addMember(
      postMember({ githubLogin: "ada", role: "viewer" }),
      orgParams,
    );
    assert.equal(res.status, 400);
  });

  it("400 on a handle GitHub could never issue", async () => {
    await seedOrg("owner", "founder");
    signedInAs("founder");
    for (const githubLogin of ["", "-ada", "ada-", "a b", "a".repeat(40)]) {
      const res = await addMember(
        postMember({ githubLogin, role: "member" }),
        orgParams,
      );
      assert.equal(
        res.status,
        400,
        `expected 400 for ${JSON.stringify(githubLogin)}`,
      );
    }
  });

  it("202 invite even when the handle resolves to an existing user — never a direct add", async () => {
    // The local users.github_login column is a CACHE of a mutable, recyclable
    // identifier. Handle ownership is only provably current at OAuth sign-in,
    // so adding by cached handle could hand membership to whoever holds the
    // account TODAY under a userId minted for whoever held it back then.
    // Always-invite makes redemption happen at sign-in, where GitHub itself
    // vouches for the handle — and the uniform 202 stops the response from
    // disclosing whether a handle has ever signed in here (D-A4).
    const store = await seedOrg("owner", "founder");
    const ada = await seedUser("ada");

    signedInAs("founder");
    const res = await addMember(
      postMember({ githubLogin: "Ada", role: "member" }),
      orgParams,
    );
    assert.equal(res.status, 202);
    assert.equal(
      await store.orgs.memberRole(ORG, ada),
      null,
      "no membership may exist until the invite is redeemed at sign-in",
    );
    const pending = await store.orgs.listPendingInvites(ORG);
    assert.equal(pending.length, 1);
    assert.equal(await store.audit.countFor("org.invite", ORG), 1);
  });

  it("400 on a JSON null body, not a 500", async () => {
    await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await addMember(postMember(null), orgParams);
    assert.equal(res.status, 400);
  });

  it("202 with an invite when the handle has never signed in", async () => {
    const store = await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await addMember(
      postMember({ githubLogin: "ada", role: "member" }),
      orgParams,
    );
    // 202, not 201: no membership exists yet, so a client that rendered this
    // as "added" would be lying.
    assert.equal(res.status, 202);
    const body = (await res.json()) as {
      invite: { githubLogin: string; role: string; expiresAt: string };
    };
    assert.equal(body.invite.githubLogin, "ada");
    assert.equal(body.invite.role, "member");
    assert.ok(body.invite.expiresAt > new Date().toISOString());
    assert.equal(await store.audit.countFor("org.invite", ORG), 1);

    const pending = await store.orgs.listPendingInvites(ORG);
    assert.equal(pending.length, 1);
  });

  it("re-inviting an existing member is still a uniform 202, and touches no role", async () => {
    const store = await seedOrg("owner", "founder");
    const ada = await seedUser("ada");
    await store.orgs.addMember(ORG, ada, "owner");

    signedInAs("founder");
    const res = await addMember(
      postMember({ githubLogin: "ada", role: "member" }),
      orgParams,
    );
    assert.equal(res.status, 202);
    assert.equal(
      await store.orgs.memberRole(ORG, ada),
      "owner",
      "an invite must never demote a live membership",
    );
  });
});

describe("H1.2 — DELETE /api/orgs/[orgId]/members/[userId]", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a session", async () => {
    signedInAs(null);
    const res = await removeMember(
      deleteMember("dev-1"),
      memberParams("dev-1"),
    );
    assert.equal(res.status, 401);
  });

  it("204 for the owner removing someone, with the team cascade and one audit row", async () => {
    const store = await seedOrg("owner", "founder");
    await store.orgs.addMember(ORG, "dev-1", "member");
    const team = await store.teams.createTeam({
      orgId: ORG,
      slug: "platform",
      name: "Platform",
      createdBy: "founder",
    });
    await store.teams.addMember(team.id, "dev-1");
    assert.equal(await store.teams.isMember(team.id, "dev-1"), true);
    const before = await store.audit.countFor("org.member.remove", ORG);

    signedInAs("founder");
    const res = await removeMember(
      deleteMember("dev-1"),
      memberParams("dev-1"),
    );
    assert.equal(res.status, 204);
    assert.equal(await store.orgs.memberRole(ORG, "dev-1"), null);
    assert.equal(
      await store.teams.isMember(team.id, "dev-1"),
      false,
      "removal must cascade to team memberships (P-A2)",
    );
    assert.equal(
      (await store.audit.countFor("org.member.remove", ORG)) - before,
      1,
    );
  });

  it("403 when a MEMBER tries to remove someone else", async () => {
    const store = await seedOrg("owner", "founder");
    await store.orgs.addMember(ORG, "dev-1", "member");
    await store.orgs.addMember(ORG, "dev-2", "member");

    signedInAs("dev-1");
    const res = await removeMember(
      deleteMember("dev-2"),
      memberParams("dev-2"),
    );
    assert.equal(res.status, 403);
    assert.equal(
      await store.orgs.memberRole(ORG, "dev-2"),
      "member",
      "the refusal must leave the membership intact",
    );
  });

  it("204 when a member leaves the org THEMSELVES, teams included", async () => {
    // Without self-removal a `member` has no exit at all: only an owner can
    // remove people, so leaving would depend on someone else's cooperation.
    const store = await seedOrg("owner", "founder");
    await store.orgs.addMember(ORG, "dev-1", "member");
    const team = await store.teams.createTeam({
      orgId: ORG,
      slug: "platform",
      name: "Platform",
      createdBy: "founder",
    });
    await store.teams.addMember(team.id, "dev-1");

    signedInAs("dev-1");
    const res = await removeMember(
      deleteMember("dev-1"),
      memberParams("dev-1"),
    );
    assert.equal(res.status, 204);
    assert.equal(await store.orgs.memberRole(ORG, "dev-1"), null);
    assert.equal(
      await store.teams.isMember(team.id, "dev-1"),
      false,
      "leaving reuses the same cascade as being removed",
    );
  });

  it("409 when the SOLE owner tries to leave", async () => {
    // Self-removal is not an escape hatch from the last-owner invariant: the
    // org would be left administerable by nobody.
    const store = await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await removeMember(
      deleteMember("founder"),
      memberParams("founder"),
    );
    assert.equal(res.status, 409);
    assert.equal(await store.orgs.memberRole(ORG, "founder"), "owner");
  });

  it("204 once a second owner exists, so the 409 above is the invariant", async () => {
    const store = await seedOrg("owner", "founder");
    await store.orgs.addMember(ORG, "second", "owner");
    signedInAs("founder");
    const res = await removeMember(
      deleteMember("founder"),
      memberParams("founder"),
    );
    assert.equal(res.status, 204);
    assert.equal(await store.orgs.memberRole(ORG, "founder"), null);
  });
});

describe("H1.2 — PATCH /api/orgs/[orgId]/members/[userId]", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a session", async () => {
    signedInAs(null);
    const res = await changeRole(
      patchMember("dev-1", { role: "owner" }),
      memberParams("dev-1"),
    );
    assert.equal(res.status, 401);
  });

  it("403 for an org MEMBER: role changes are owner-only", async () => {
    const store = await seedOrg("member", "dev-1");
    await store.orgs.addMember(ORG, "dev-2", "member");
    signedInAs("dev-1");
    const res = await changeRole(
      patchMember("dev-2", { role: "owner" }),
      memberParams("dev-2"),
    );
    assert.equal(res.status, 403);
  });

  it("400 on a role outside the two H1.3 roles", async () => {
    await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await changeRole(
      patchMember("founder", { role: "admin" }),
      memberParams("founder"),
    );
    assert.equal(res.status, 400);
  });

  it("404 when the target is not a member — no invisible add-by-PATCH", async () => {
    await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await changeRole(
      patchMember("stranger", { role: "member" }),
      memberParams("stranger"),
    );
    assert.equal(res.status, 404);
  });

  it("200 promoting a member to owner, with a role_change audit row", async () => {
    const store = await seedOrg("owner", "founder");
    await store.orgs.addMember(ORG, "dev-1", "member");
    const before = await store.audit.countFor("org.member.role_change", ORG);

    signedInAs("founder");
    const res = await changeRole(
      patchMember("dev-1", { role: "owner" }),
      memberParams("dev-1"),
    );
    assert.equal(res.status, 200);
    assert.equal(await store.orgs.memberRole(ORG, "dev-1"), "owner");
    assert.equal(
      (await store.audit.countFor("org.member.role_change", ORG)) - before,
      1,
      "a promotion is a role_change, not an add",
    );
  });

  it("409 when demoting the org's last owner — same invariant as removal", async () => {
    const store = await seedOrg("owner", "founder");
    signedInAs("founder");
    const res = await changeRole(
      patchMember("founder", { role: "member" }),
      memberParams("founder"),
    );
    assert.equal(res.status, 409);
    assert.equal(
      await store.orgs.memberRole(ORG, "founder"),
      "owner",
      "the refusal must leave the role untouched",
    );
  });

  it("200 demoting once a second owner exists, so the 409 above is the invariant", async () => {
    const store = await seedOrg("owner", "founder");
    await store.orgs.addMember(ORG, "second", "owner");
    signedInAs("founder");
    const res = await changeRole(
      patchMember("founder", { role: "member" }),
      memberParams("founder"),
    );
    assert.equal(res.status, 200);
    assert.equal(await store.orgs.memberRole(ORG, "founder"), "member");
  });
});
