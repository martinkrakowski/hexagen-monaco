import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { AdapterAccount } from "next-auth/adapters";
import type { SavedProject } from "@hexagen/shared";
import { createPlatformStore } from "../store";
import { openPlatformDb } from "../platform-db";
import { createRepairTelemetryStore } from "../repair-telemetry-store";

/**
 * Every store method that application code (routes, guards, handlers) calls must
 * return a Promise — the SQLite driver is moving to an asynchronous path. This
 * test pins each signature at runtime so a future revert to synchronous breaks
 * the suite before it breaks callers.
 */
describe("async contract — 30 store methods return Promises", () => {
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
    const telemetry = createRepairTelemetryStore(db, OWNER);

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
});
