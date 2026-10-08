import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { AdapterAccount } from "next-auth/adapters";
import type { SavedProject } from "@hexagen/shared";
import { createPlatformStore } from "../store";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createRepairTelemetryStore } from "../repair-telemetry-store";

/**
 * Every store method that application code (routes, guards, handlers) calls must
 * return a Promise — the SQLite driver is moving to an asynchronous path. This
 * test pins each signature at runtime so a future revert to synchronous breaks
 * the suite before it breaks callers.
 */
/**
 * Each case must be a Promise, and must settle the way the test says: a method
 * that rejects when it was expected to resolve is a failure, so a broken
 * statement cannot hide behind "it returned a Promise".
 */
async function assertPromisesSettle(
  cases: ReadonlyArray<{ name: string; result: unknown }>,
  expectedRejections: readonly string[],
): Promise<void> {
  for (const { name, result } of cases) {
    assert.ok(
      result instanceof Promise,
      `${name} must return a Promise, got ${typeof result}`,
    );
  }
  const settled = await Promise.allSettled(
    cases.map((c) => c.result as Promise<unknown>),
  );
  const rejected = cases
    .filter((_, i) => settled[i]?.status === "rejected")
    .map((c) => c.name);
  assert.deepEqual(rejected, [...expectedRejections]);
}

const EXPECTED_REJECTIONS_1: readonly string[] = [];
const EXPECTED_REJECTIONS_2: readonly string[] = [];
const EXPECTED_REJECTIONS_3: readonly string[] = [];

describe("async contract — 60 store methods return Promises", () => {
  const store = createPlatformStore(":memory:");
  const OWNER = "user-owner";

  const sampleProject = (id: string): SavedProject => ({
    id,
    name: "sample",
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
    manifestYaml: "system: sample\nbounded_contexts: []\n",
  });

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

  it("each AuthRepository method returns a Promise", async () => {
    const auth = store.auth;
    const created = await auth.createUser({
      name: "Ada",
      email: "ada@example.com",
      emailVerified: null,
    });

    const cases: { name: string; result: unknown }[] = [
      {
        name: "createUser",
        result: auth.createUser({
          name: "Other",
          email: "other@example.com",
          emailVerified: null,
        }),
      },
      { name: "getUser", result: auth.getUser(created.id) },
      {
        name: "getUserByEmail",
        result: auth.getUserByEmail("ada@example.com"),
      },
      {
        name: "getUserByAccount",
        result: auth.getUserByAccount("github", "12345"),
      },
      {
        name: "updateUser",
        result: auth.updateUser({ id: created.id, name: "Ada Updated" }),
      },
      {
        name: "getUserByGithubLogin",
        result: auth.getUserByGithubLogin("ada"),
      },
      {
        name: "linkAccount",
        result: auth.linkAccount({
          provider: "github",
          providerAccountId: "12345",
          userId: created.id,
          type: "oauth",
        } as AdapterAccount),
      },
      {
        name: "unlinkAccount",
        result: auth.unlinkAccount("github", "12345"),
      },
      {
        name: "createSession",
        result: auth.createSession({
          sessionToken: "tok-1",
          userId: created.id,
          expires: new Date("2026-12-31"),
        }),
      },
      { name: "getSessionAndUser", result: auth.getSessionAndUser("tok-1") },
      {
        name: "updateSession",
        result: auth.updateSession({
          sessionToken: "tok-1",
          expires: new Date("2027-01-01"),
        }),
      },
      { name: "deleteSession", result: auth.deleteSession("tok-1") },
      {
        name: "createVerificationToken",
        result: auth.createVerificationToken({
          identifier: "ada@example.com",
          token: "verify-1",
          expires: new Date("2026-12-31"),
        }),
      },
      {
        name: "useVerificationToken",
        result: auth.useVerificationToken({
          identifier: "ada@example.com",
          token: "verify-1",
        }),
      },
    ];

    for (const { name, result } of cases) {
      assert.ok(
        result instanceof Promise,
        `${name} must return a Promise, got ${typeof result}`,
      );
      // Settles without rejecting; what it resolves to is not this test's subject.
      await result;
    }

    // setGithubLogin, getOnboardedAt, markOnboarded are async by prior contract.
    assert.ok(auth.setGithubLogin(created.id, "ada") instanceof Promise);
    await auth.setGithubLogin(created.id, "ada");
  });

  it("each EntitlementRepository method returns a Promise", async () => {
    const billing = store.billing;

    const resolveResult = billing.resolve(OWNER);
    assert.ok(
      resolveResult instanceof Promise,
      "resolve must return a Promise",
    );
    await resolveResult;

    const upsertResult = billing.upsert({
      userId: OWNER,
      plan: "free",
      repoLimit: 0,
      status: "none",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
    });
    assert.ok(upsertResult instanceof Promise, "upsert must return a Promise");
    await upsertResult;
  });

  it("each RunHistoryRepository method returns a Promise", async () => {
    const runs = store.runsFor(OWNER);

    const recordResult = runs.record({ runId: "run-1", telemetry });
    assert.ok(recordResult instanceof Promise, "record must return a Promise");
    await recordResult;

    const listResult = runs.list({ limit: 10 });
    assert.ok(listResult instanceof Promise, "list must return a Promise");
    await listResult;

    const trendResult = runs.trend(14);
    assert.ok(trendResult instanceof Promise, "trend must return a Promise");
    await trendResult;
  });

  it("each SavedProjectsStore method returns a Promise", async () => {
    const projects = store.projectsFor(OWNER);
    const p = sampleProject("11111111-1111-4111-8111-111111111111");
    await projects.createProjectRecord(p);

    const putPromise = projects.putProject(p, undefined, "writer");
    assert.ok(
      putPromise instanceof Promise,
      "putProject must return a Promise",
    );
    await putPromise;

    const getResult = projects.getProject(p.id);
    assert.ok(getResult instanceof Promise, "getProject must return a Promise");
    await getResult;

    const getWithRev = projects.getProjectWithRev(p.id);
    assert.ok(
      getWithRev instanceof Promise,
      "getProjectWithRev must return a Promise",
    );
    await getWithRev;
  });

  it("each ScanRecordsStore method returns a Promise", async () => {
    const scans = store.scansFor(OWNER);

    const recordResult = scans.record({
      projectName: "shop",
      tier: "B",
      verdict: "violations",
    });
    assert.ok(recordResult instanceof Promise, "record must return a Promise");
    await recordResult;

    const listResult = scans.list();
    assert.ok(listResult instanceof Promise, "list must return a Promise");
    await listResult;

    const getResult = scans.get("missing");
    assert.ok(getResult instanceof Promise, "get must return a Promise");
    await getResult;

    const trendResult = scans.trend();
    assert.ok(trendResult instanceof Promise, "trend must return a Promise");
    await trendResult;
  });

  it("each RepairTelemetryStore method returns a Promise", async () => {
    const db = openPlatformDb(":memory:");
    const telemetry = createRepairTelemetryStore(
      createSqlitePlatformDb(db),
      OWNER,
    );

    const recordResult = telemetry.record({
      surface: "client-deterministic",
      outcome: "deterministic-fixed",
      rounds: 1,
      violationsInitial: 1,
      violationsRemaining: 0,
      durationMs: 12,
    });
    assert.ok(recordResult instanceof Promise, "record must return a Promise");
    await recordResult;

    const listRunsResult = telemetry.listRuns();
    assert.ok(
      listRunsResult instanceof Promise,
      "listRuns must return a Promise",
    );
    await listRunsResult;

    const listAttemptsResult = telemetry.listAttempts(
      "11111111-1111-4111-8111-111111111111",
    );
    assert.ok(
      listAttemptsResult instanceof Promise,
      "listAttempts must return a Promise",
    );
    await listAttemptsResult;

    const classStatsResult = telemetry.classStats();
    assert.ok(
      classStatsResult instanceof Promise,
      "classStats must return a Promise",
    );
    await classStatsResult;

    db.close();
  });

  it("each AuditLogRepository method returns a Promise", async () => {
    const audit = store.audit;

    const appendResult = audit.append({
      actorId: "actor-1",
      action: "team.member.add",
      subjectOwnerId: "org-1",
      subjectId: "team-1",
      granteeType: "user",
      granteeId: "user-1",
    });
    assert.ok(appendResult instanceof Promise, "append must return a Promise");
    await appendResult;

    const countResult = audit.countFor("team.member.add", "team-1");
    assert.ok(countResult instanceof Promise, "countFor must return a Promise");
    await countResult;
  });

  it("each OrgsRepository method returns a Promise", async () => {
    const orgs = store.orgs;

    // Set up: an org with an owner so subsequent methods have valid data.
    const org = await orgs.createOrgWithOwner(
      { slug: "test-org", name: "Test Org", createdBy: OWNER },
      { actorId: OWNER },
    );

    const cases: { name: string; result: unknown }[] = [
      {
        name: "createOrg",
        result: orgs.createOrg({
          slug: "other-org",
          name: "Other",
          createdBy: OWNER,
        }),
      },
      {
        name: "createOrgWithOwner",
        result: orgs.createOrgWithOwner(
          { slug: "second-org", name: "Second", createdBy: "user-2" },
          { actorId: "user-2" },
        ),
      },
      { name: "getOrg", result: orgs.getOrg(org.id) },
      { name: "getOrgBySlug", result: orgs.getOrgBySlug("test-org") },
      {
        name: "addMember",
        result: orgs.addMember(org.id, "user-2", "member"),
      },
      {
        name: "removeMember",
        result: orgs.removeMember(org.id, "user-2", { actorId: OWNER }),
      },
      { name: "memberRole", result: orgs.memberRole(org.id, OWNER) },
      { name: "listOrgIdsForUser", result: orgs.listOrgIdsForUser(OWNER) },
      { name: "listMembers", result: orgs.listMembers(org.id) },
      {
        name: "invite",
        result: orgs.invite(org.id, "github-user", "member", {
          actorId: OWNER,
        }),
      },
      { name: "listPendingInvites", result: orgs.listPendingInvites(org.id) },
      {
        name: "acceptInvitesForLogin",
        result: orgs.acceptInvitesForLogin("id-1", "github-user"),
      },
      { name: "listOrgsForUser", result: orgs.listOrgsForUser(OWNER) },
      {
        name: "deleteOrg",
        result: orgs.deleteOrg("nonexistent-org", { actorId: OWNER }),
      },
    ];

    await assertPromisesSettle(cases, EXPECTED_REJECTIONS_1);
  });

  it("each TeamsRepository method returns a Promise", async () => {
    const teams = store.teams;

    // Set up: an org with an owner and a member, and a team with a member.
    const org = await store.orgs.createOrgWithOwner(
      { slug: "test-teams", name: "Test Teams", createdBy: OWNER },
      { actorId: OWNER },
    );
    await store.orgs.addMember(org.id, "member-1", "member");
    const team = await teams.createTeam(
      {
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: OWNER,
      },
      { actorId: OWNER },
    );
    await teams.addMember(team.id, "member-1", { actorId: OWNER });

    const cases: { name: string; result: unknown }[] = [
      {
        name: "createTeam",
        result: teams.createTeam({
          orgId: org.id,
          slug: "second-team",
          name: "Second Team",
          createdBy: OWNER,
        }),
      },
      { name: "getTeam", result: teams.getTeam(team.id) },
      {
        name: "getTeamBySlug",
        result: teams.getTeamBySlug(org.id, "platform"),
      },
      { name: "listTeamsForOrg", result: teams.listTeamsForOrg(org.id) },
      {
        name: "deleteTeam",
        result: teams.deleteTeam("nonexistent-team", { actorId: OWNER }),
      },
      {
        name: "addMember",
        result: teams.addMember(team.id, "member-1", { actorId: OWNER }),
      },
      {
        name: "removeMember",
        result: teams.removeMember(team.id, "member-1", { actorId: OWNER }),
      },
      { name: "isMember", result: teams.isMember(team.id, "member-1") },
      {
        name: "listTeamIdsForUser",
        result: teams.listTeamIdsForUser("member-1"),
      },
    ];

    await assertPromisesSettle(cases, EXPECTED_REJECTIONS_2);
  });

  it("each ProjectSharesRepository method returns a Promise", async () => {
    const shares = store.shares;

    // Set up: a live grant to revoke and observe.
    await shares.grant(
      {
        ownerId: OWNER,
        projectId: "proj-1",
        granteeType: "user",
        granteeId: "member-1",
        role: "read",
        grantedBy: OWNER,
      },
      { actorId: OWNER },
    );

    const cases: { name: string; result: unknown }[] = [
      {
        name: "grant",
        result: shares.grant(
          {
            ownerId: OWNER,
            projectId: "proj-1",
            granteeType: "user",
            granteeId: "member-1",
            role: "read",
            grantedBy: OWNER,
          },
          { actorId: OWNER },
        ),
      },
      {
        name: "revoke",
        result: shares.revoke(
          {
            ownerId: OWNER,
            projectId: "proj-1",
            granteeType: "user",
            granteeId: "member-1",
          },
          { actorId: OWNER },
        ),
      },
      {
        name: "listForProject",
        result: shares.listForProject(OWNER, "proj-1"),
      },
      {
        name: "accessFor",
        result: shares.accessFor(OWNER, "proj-1", {
          userId: "member-1",
          orgIds: [],
          teamIds: [],
        }),
      },
      {
        name: "selectSharedWith",
        result: shares.selectSharedWith({
          userId: "member-1",
          orgIds: [],
          teamIds: [],
        }),
      },
    ];

    await assertPromisesSettle(cases, EXPECTED_REJECTIONS_3);
  });

  it("close returns a Promise", async () => {
    const store = createPlatformStore(":memory:");
    const result = store.close();
    assert.ok(result instanceof Promise, "close must return a Promise");
    await result;
  });
});
