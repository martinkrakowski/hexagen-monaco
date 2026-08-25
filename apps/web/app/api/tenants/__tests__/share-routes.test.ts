import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import {
  GET as SHARES_GET,
  POST as SHARES_POST,
} from "../[ownerId]/projects/[projectId]/shares/route";
import { DELETE as SHARE_DELETE } from "../[ownerId]/projects/[projectId]/shares/[granteeType]/[granteeId]/route";
import { GET as SHARED_GET } from "../../projects/shared/route";
import { GET as TENANT_GET } from "../[ownerId]/projects/[projectId]/route";
import { closePlatformStore, getPlatformStore } from "../../../../lib/platform";
import { openPlatformDb } from "../../../../lib/platform/platform-db";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * P-A4 at the route boundary.
 *
 * Every refusal is asserted next to proof that the thing being refused really
 * exists — a 403 or a 404 over an empty database passes without the rule ever
 * running. The lifecycle test in particular asserts the grant WORKED before it
 * is revoked, so "refused after revoke" cannot be satisfied by a share that
 * never took effect.
 */

const OWNER = "user-owner";
const GRANTEE = "user-grantee";
const OUTSIDER = "user-outsider";
const PROJECT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function sample(id = PROJECT): SavedProject {
  return {
    id,
    name: "owned",
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
    manifestYaml: "system: owned\nbounded_contexts: []\n",
  };
}

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

const sharesUrl = (owner = OWNER, project = PROJECT) =>
  `http://localhost/api/tenants/${owner}/projects/${project}/shares`;

const sharesParams = (owner = OWNER, project = PROJECT) => ({
  params: Promise.resolve({ ownerId: owner, projectId: project }),
});

function postShare(
  grantee: string,
  role = "read",
  owner = OWNER,
  project = PROJECT,
) {
  return SHARES_POST(
    new NextRequest(sharesUrl(owner, project), {
      method: "POST",
      // No `Origin`: a missing one is same-origin by design (request-guards),
      // which is how every other route test here drives a mutation.
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grantee, role }),
    }),
    sharesParams(owner, project),
  );
}

function deleteShare(
  granteeType: string,
  granteeId: string,
  owner = OWNER,
  project = PROJECT,
) {
  return SHARE_DELETE(
    new NextRequest(
      `${sharesUrl(owner, project)}/${granteeType}/${granteeId}`,
      { method: "DELETE" },
    ),
    {
      params: Promise.resolve({
        ownerId: owner,
        projectId: project,
        granteeType,
        granteeId,
      }),
    },
  );
}

function liveGrantCount(projectId: string): number {
  const db = openPlatformDb(dbPath);
  try {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n FROM project_shares WHERE project_id = ? AND revoked_at IS NULL",
      )
      .get(projectId) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

const readProject = (as: string) => {
  signedInAs(as);
  return TENANT_GET(new NextRequest(sharesUrl().replace("/shares", "")), {
    params: Promise.resolve({ ownerId: OWNER, projectId: PROJECT }),
  });
};

/**
 * The audit log exports no reader by design (D-A6), so the assertion opens a
 * second connection to the same file. That is also why this suite runs against
 * a temp FILE rather than `:memory:`: an in-memory database cannot be reached
 * from a second handle, and adding a reader to the product purely to satisfy a
 * test would be product surface with no product behind it.
 */
let dbPath = "";
let previousDbPath: string | undefined;

function auditRows(): {
  actor_id: string;
  action: string;
  grantee_id: string | null;
}[] {
  const db = openPlatformDb(dbPath);
  try {
    // No ORDER BY: `audit_log.id` is a random UUID and `created_at` has only
    // millisecond resolution, so the table has no reliable total order for two
    // events in the same request pair. Asserting a sequence here passed in
    // isolation and failed in the full suite purely on UUID collation — a test
    // that was passing by luck. The claim below is about WHICH rows exist.
    return db
      .prepare("SELECT actor_id, action, grantee_id FROM audit_log")
      .all() as {
      actor_id: string;
      action: string;
      grantee_id: string | null;
    }[];
  } finally {
    db.close();
  }
}

async function seedProject(): Promise<void> {
  const created = await getPlatformStore()
    .projectsFor(OWNER)
    .createProjectRecord(sample());
  assert.equal(created.success, true, "fixture project must be created");
}

/** A signed-in user with a typeable handle. */
async function seedUser(id: string, login: string): Promise<void> {
  const db = openPlatformDb(dbPath);
  try {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)",
    ).run(id, login, `${login}@example.test`, new Date().toISOString());
  } finally {
    db.close();
  }
  await getPlatformStore().auth.setGithubLogin(id, login);
}

describe("P-A4 — share and revoke", () => {
  beforeEach(async () => {
    closePlatformStore();
    previousDbPath = process.env.PLATFORM_DB_PATH;
    dbPath = join(mkdtempSync(join(tmpdir(), "hexagen-shares-")), "p.db");
    process.env.PLATFORM_DB_PATH = dbPath;
    signedInAs(OWNER);
    await seedProject();
    await seedUser(GRANTEE, "grantee");
    await seedUser(OUTSIDER, "outsider");
  });

  afterEach(() => {
    closePlatformStore();
    if (previousDbPath === undefined) delete process.env.PLATFORM_DB_PATH;
    else process.env.PLATFORM_DB_PATH = previousDbPath;
  });

  it("the plan's lifecycle: 403 → share → 200 → revoke → 403 on the very next call", async () => {
    // Before: refused, and the project provably exists in the owner's tenant.
    const before = await readProject(GRANTEE);
    assert.equal(before.status, 403);
    const exists = getPlatformStore().projectsFor(OWNER).getProject(PROJECT);
    assert.equal(exists.success && Boolean(exists.value), true);

    signedInAs(OWNER);
    const shared = await postShare("@grantee", "read");
    assert.equal(shared.status, 200);

    // The grant WORKED. Without this the revocation assertion below would pass
    // over a share that never took effect.
    const during = await readProject(GRANTEE);
    assert.equal(during.status, 200, "the read grant must actually grant read");

    signedInAs(OWNER);
    const revoked = await deleteShare("user", GRANTEE);
    assert.equal(revoked.status, 200);

    // No cache layer between: same process, next call.
    const after = await readProject(GRANTEE);
    assert.equal(after.status, 403, "revocation takes effect immediately");

    const rows = auditRows();
    assert.equal(rows.length, 2, "one grant row and one revoke row");
    assert.deepEqual(
      rows.map((r) => r.action).sort(),
      ["share.grant", "share.revoke"],
      "both actions are recorded (order is not a property of this table)",
    );
    assert.ok(
      rows.every((r) => r.actor_id === OWNER && r.grantee_id === GRANTEE),
      "audit rows name the acting owner and the grantee",
    );
  });

  it("shares via an org handle", async () => {
    const store = getPlatformStore();
    const org = await store.orgs.createOrg({
      slug: "acme",
      name: "Acme",
      createdBy: OUTSIDER,
    });
    await store.orgs.addMember(org.id, GRANTEE, "member");

    signedInAs(OWNER);
    assert.equal((await postShare("@acme", "read")).status, 200);
    assert.equal((await readProject(GRANTEE)).status, 200);
  });

  it("shares via a team handle (a team is a grantee, D-A1)", async () => {
    const store = getPlatformStore();
    const org = await store.orgs.createOrg({
      slug: "acme",
      name: "Acme",
      createdBy: OUTSIDER,
    });
    await store.orgs.addMember(org.id, GRANTEE, "member");
    const team = await store.teams.createTeam({
      orgId: org.id,
      slug: "platform",
      name: "Platform",
      createdBy: OUTSIDER,
    });
    await store.teams.addMember(team.id, GRANTEE);

    signedInAs(OWNER);
    assert.equal((await postShare("@acme/platform", "write")).status, 200);
    assert.equal((await readProject(GRANTEE)).status, 200);
  });

  it("a write grantee may NOT share or revoke — only the owner may", async () => {
    signedInAs(OWNER);
    assert.equal((await postShare("@grantee", "write")).status, 200);
    // The grant is real: the grantee can reach the project.
    assert.equal((await readProject(GRANTEE)).status, 200);

    signedInAs(GRANTEE);
    assert.equal(
      (await postShare("@outsider", "read")).status,
      403,
      "a write grant must not mint further grants",
    );
    assert.equal((await deleteShare("user", GRANTEE)).status, 403);

    // And the outsider never gained access from the refused share.
    assert.equal((await readProject(OUTSIDER)).status, 403);
  });

  it("an unknown handle is indistinguishable from one the caller may not target", async () => {
    signedInAs(OWNER);
    const unknown = await postShare("@no-such-person", "read");
    const malformed = await postShare("@not/a/valid/handle", "read");

    assert.equal(unknown.status, 404);
    assert.equal(malformed.status, 404);
    // Body equality is the assertion; latency is not measurable here, and
    // saying so is better than a timing check that would flake.
    const unknownBody = await unknown.json();
    assert.deepEqual(unknownBody, await malformed.json());

    // The load-bearing half. Today both inputs reach ONE refusal site, so the
    // equality above is close to tautological — it guards against a future
    // branch, not against anything present. What is checkable NOW is that the
    // refusal does not echo what was searched for: a body reading "no such
    // user @x" versus "no such org @x" would be an enumeration oracle even
    // while both are 404. Assert the handle appears nowhere in the response.
    const serialised = JSON.stringify(unknownBody);
    assert.doesNotMatch(serialised, /no-such-person/);
    assert.doesNotMatch(serialised, /@/);
  });

  it("GET /api/projects/shared lists only LIVE grants", async () => {
    signedInAs(OWNER);
    assert.equal((await postShare("@grantee", "read")).status, 200);

    signedInAs(GRANTEE);
    const listed = await SHARED_GET(
      new NextRequest("http://localhost/api/projects/shared"),
    );
    const body = (await listed.json()) as {
      shared: { projectId: string; role: string }[];
    };
    // Non-vacuous: it was present BEFORE the revocation.
    assert.equal(body.shared.length, 1);
    assert.equal(body.shared[0].projectId, PROJECT);
    assert.equal(body.shared[0].role, "read");

    signedInAs(OWNER);
    await deleteShare("user", GRANTEE);

    signedInAs(GRANTEE);
    const after = await SHARED_GET(
      new NextRequest("http://localhost/api/projects/shared"),
    );
    const afterBody = (await after.json()) as { shared: unknown[] };
    assert.equal(afterBody.shared.length, 0, "a revoked grant is not listed");
  });

  it("the owner lists the grants on their project; an outsider is refused", async () => {
    signedInAs(OWNER);
    await postShare("@grantee", "write");

    const owned = await SHARES_GET(
      new NextRequest(sharesUrl()),
      sharesParams(),
    );
    assert.equal(owned.status, 200);
    const body = (await owned.json()) as { shares: { granteeId: string }[] };
    assert.equal(body.shares.length, 1);
    assert.equal(body.shares[0].granteeId, GRANTEE);

    signedInAs(OUTSIDER);
    const denied = await SHARES_GET(
      new NextRequest(sharesUrl()),
      sharesParams(),
    );
    assert.equal(denied.status, 403);
  });

  it("401 without a JWT", async () => {
    signedInAs(null);
    assert.equal((await postShare("@grantee")).status, 401);
    assert.equal(
      (
        await SHARED_GET(
          new NextRequest("http://localhost/api/projects/shared"),
        )
      ).status,
      401,
    );
  });

  it("sharing a UUID with no project does not leave a live grant a later create would activate", async () => {
    const missing = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    signedInAs(OWNER);
    const shared = await postShare("@grantee", "read", OWNER, missing);
    assert.equal(shared.status, 404);
    assert.equal(
      liveGrantCount(missing),
      0,
      "no live grant may be inserted for a project that does not exist",
    );

    const created = await getPlatformStore()
      .projectsFor(OWNER)
      .createProjectRecord(sample(missing));
    assert.equal(created.success, true);

    signedInAs(GRANTEE);
    const after = await TENANT_GET(
      new NextRequest(sharesUrl(OWNER, missing).replace("/shares", "")),
      { params: Promise.resolve({ ownerId: OWNER, projectId: missing }) },
    );
    assert.equal(
      after.status,
      403,
      "creating the project later must not activate a grant that was never authorised",
    );
  });

  it("list and revoke of a missing project 404 for the owner and stay 403 for an outsider", async () => {
    const missing = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    signedInAs(OWNER);
    const listed = await SHARES_GET(
      new NextRequest(sharesUrl(OWNER, missing)),
      sharesParams(OWNER, missing),
    );
    assert.equal(listed.status, 404);
    const revoked = await deleteShare("user", GRANTEE, OWNER, missing);
    assert.equal(revoked.status, 404);

    signedInAs(OUTSIDER);
    const denied = await SHARES_GET(
      new NextRequest(sharesUrl(OWNER, missing)),
      sharesParams(OWNER, missing),
    );
    assert.equal(
      denied.status,
      403,
      "a missing project must not become an existence oracle",
    );
  });

  it("overlapping grants on one project collapse to the strongest role", async () => {
    const store = getPlatformStore();
    const org = await store.orgs.createOrg({
      slug: "acme",
      name: "Acme",
      createdBy: OUTSIDER,
    });
    await store.orgs.addMember(org.id, GRANTEE, "member");

    signedInAs(OWNER);
    assert.equal((await postShare("@grantee", "read")).status, 200);
    assert.equal((await postShare("@acme", "write")).status, 200);

    signedInAs(GRANTEE);
    const listed = await SHARED_GET(
      new NextRequest("http://localhost/api/projects/shared"),
    );
    const body = (await listed.json()) as {
      shared: { projectId: string; role: string }[];
    };
    const forProject = body.shared.filter((row) => row.projectId === PROJECT);
    assert.equal(forProject.length, 1, "one project, one row");
    assert.equal(forProject[0].role, "write", "write beats read");
  });

  it("refuses a grant to the owner or the owning org, and shared-with-me omits owned projects", async () => {
    await seedUser(OWNER, "owner");
    signedInAs(OWNER);
    const self = await postShare("@owner", "read");
    assert.equal(self.status, 400);
    assert.equal(liveGrantCount(PROJECT), 0);

    const store = getPlatformStore();
    const org = await store.orgs.createOrg({
      slug: "acme",
      name: "Acme",
      createdBy: OWNER,
    });
    await store.orgs.addMember(org.id, OWNER, "owner");
    await store.orgs.addMember(org.id, GRANTEE, "member");
    const orgProject = sample("ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert.equal(
      (await store.projectsFor(org.id).createProjectRecord(orgProject)).success,
      true,
    );

    signedInAs(OWNER);
    const toOrg = await postShare("@acme", "write", org.id, orgProject.id);
    assert.equal(toOrg.status, 400);

    // Defence in depth: a planted grant on a project the caller already owns
    // must still not appear as "shared with me".
    await store.shares.grant({
      ownerId: org.id,
      projectId: orgProject.id,
      granteeType: "user",
      granteeId: GRANTEE,
      role: "read",
      grantedBy: OWNER,
    });
    signedInAs(GRANTEE);
    const listed = await SHARED_GET(
      new NextRequest("http://localhost/api/projects/shared"),
    );
    const body = (await listed.json()) as {
      shared: { projectId: string }[];
    };
    assert.equal(
      body.shared.some((row) => row.projectId === orgProject.id),
      false,
      "org members already own the org's projects",
    );
  });

  it("a failing audit insert rolls back the grant", async () => {
    closePlatformStore();
    const db = openPlatformDb(dbPath);
    db.exec(`
      CREATE TRIGGER audit_log_block_insert
      BEFORE INSERT ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit blocked'); END;
    `);
    db.close();

    signedInAs(OWNER);
    await assert.rejects(() => postShare("@grantee", "read"), /audit blocked/);
    assert.equal(liveGrantCount(PROJECT), 0, "the grant must not commit alone");
    assert.equal(auditRows().length, 0);
  });
});
