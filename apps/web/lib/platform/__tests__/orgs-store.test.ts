import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import {
  createOrgsRepository,
  DuplicateOrgSlugError,
  LastOwnerError,
  OrgOwnsProjectsError,
} from "../orgs-store";
import { createOwnerDocumentsStore } from "../owner-documents-store";
import { createSavedProjectsStore } from "../saved-projects-store";
import type { SavedProject } from "@hexagen/shared";

describe("OrgsRepository.listOrgsForUser", () => {
  it("returns this caller's orgs with roles, and nobody else's", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const acme = await store.orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      const beta = await store.orgs.createOrg({
        slug: "beta",
        name: "Beta",
        createdBy: "user-2",
      });
      await store.orgs.addMember(acme.id, "user-1", "owner");
      await store.orgs.addMember(acme.id, "user-2", "member");
      await store.orgs.addMember(beta.id, "user-2", "owner");

      const forUser1 = await store.orgs.listOrgsForUser("user-1");
      assert.equal(forUser1.length, 1);
      assert.equal(forUser1[0]?.id, acme.id);
      assert.equal(forUser1[0]?.slug, "acme");
      assert.equal(forUser1[0]?.name, "Acme");
      assert.equal(forUser1[0]?.role, "owner");

      const forUser2 = await store.orgs.listOrgsForUser("user-2");
      assert.equal(forUser2.length, 2);
      const bySlug = Object.fromEntries(forUser2.map((o) => [o.slug, o.role]));
      assert.equal(bySlug.acme, "member");
      assert.equal(bySlug.beta, "owner");

      const forStranger = await store.orgs.listOrgsForUser("nobody");
      assert.equal(forStranger.length, 0);
    } finally {
      await store.close();
    }
  });
});

describe("OrgsRepository — typed error refusals", () => {
  it("createOrgWithOwner with a taken slug rejects with DuplicateOrgSlugError and leaves no second org, no membership and no audit row", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const org = await store.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      // Non-vacuity: "other" has no orgs yet.
      assert.equal((await store.orgs.listOrgsForUser("other")).length, 0);

      await assert.rejects(
        () =>
          store.orgs.createOrgWithOwner(
            { slug: "acme", name: "Acme Again", createdBy: "other" },
            { actorId: "other" },
          ),
        (err: unknown) => {
          assert.ok(
            err instanceof DuplicateOrgSlugError,
            `expected DuplicateOrgSlugError, got ${(err as Error)?.name}`,
          );
          assert.equal((err as DuplicateOrgSlugError).slug, "acme");
          return true;
        },
      );

      // No second org for "other".
      assert.equal(
        (await store.orgs.listOrgsForUser("other")).length,
        0,
        "the failed create must not list an org for the second user",
      );
      // No membership for "other" in the org.
      assert.equal(
        await store.orgs.memberRole(org.id, "other"),
        null,
        "the failed create must not add a membership",
      );
      // No second audit row: the original org.create is the only one.
      assert.equal(
        await store.audit.countFor("org.create", org.id),
        1,
        "the failed create must not write an audit row",
      );
    } finally {
      await store.close();
    }
  });

  it("demoting or removing the last owner rejects with LastOwnerError and the member stays an owner", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const org = await store.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      // Demoting: founder is the only owner, so demotion to member must refuse.
      await assert.rejects(
        () => store.orgs.addMember(org.id, "founder", "member"),
        (err: unknown) => {
          assert.ok(err instanceof LastOwnerError);
          return true;
        },
      );
      // The founder is still an owner — the refusal rolled back.
      assert.equal(await store.orgs.memberRole(org.id, "founder"), "owner");

      // Removing the last owner must also refuse.
      await assert.rejects(
        () => store.orgs.removeMember(org.id, "founder"),
        (err: unknown) => {
          assert.ok(err instanceof LastOwnerError);
          return true;
        },
      );
      assert.equal(await store.orgs.memberRole(org.id, "founder"), "owner");
    } finally {
      await store.close();
    }
  });

  it("deleteOrg of an org that owns a project rejects with OrgOwnsProjectsError; org, members and teams survive", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const org = await store.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      await store.orgs.addMember(org.id, "member-1", "member");
      const team = await store.teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });

      // Non-vacuity: the org owns a project before the deletion attempt.
      const project = {
        id: "p-1",
        name: "Project",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as SavedProject;
      const created = await store
        .projectsFor(org.id)
        .createProjectRecord(project);
      assert.equal(created.success, true, "fixture project must be created");

      await assert.rejects(
        () => store.orgs.deleteOrg(org.id, { actorId: "owner-1" }),
        (err: unknown) => {
          assert.ok(err instanceof OrgOwnsProjectsError);
          return true;
        },
      );

      // Org survives.
      assert.ok(
        await store.orgs.getOrg(org.id),
        "org must survive the refusal",
      );
      // Member survives.
      assert.equal(
        await store.orgs.memberRole(org.id, "member-1"),
        "member",
        "member must survive the refusal",
      );
      // Team survives.
      const teams = await store.teams.listTeamsForOrg(org.id);
      assert.equal(teams.length, 1, "team must survive the refusal");
      assert.equal(teams[0]?.id, team.id);
    } finally {
      await store.close();
    }
  });
});

describe("OrgsRepository.acceptInvitesForLogin", () => {
  it("accepts only the signing-in login's invites, and leaves every other pending invite pending", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const acme = await store.orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      const beta = await store.orgs.createOrg({
        slug: "beta",
        name: "Beta",
        createdBy: "user-1",
      });
      const audit = { actorId: "user-1" };
      await store.orgs.invite(acme.id, "ada", "member", audit);
      await store.orgs.invite(acme.id, "grace", "member", audit);
      await store.orgs.invite(beta.id, "grace", "owner", audit);

      const joined = await store.orgs.acceptInvitesForLogin("ada-user", "ada");
      assert.deepEqual(joined, [acme.id]);

      // The UPDATE that stamps an invite accepted is keyed by org AND login.
      // Without that key it would stamp every invite in the table.
      const acmePending = await store.orgs.listPendingInvites(acme.id);
      assert.deepEqual(
        acmePending.map((i) => i.githubLogin),
        ["grace"],
      );
      const betaPending = await store.orgs.listPendingInvites(beta.id);
      assert.deepEqual(
        betaPending.map((i) => i.githubLogin),
        ["grace"],
      );

      const later = await store.orgs.acceptInvitesForLogin(
        "grace-user",
        "grace",
      );
      assert.deepEqual([...later].sort(), [acme.id, beta.id].sort());
      assert.equal(await store.orgs.memberRole(beta.id, "grace-user"), "owner");
    } finally {
      await store.close();
    }
  });
});

function docCount(
  db: ReturnType<typeof openPlatformDb>,
  ownerId: string,
  userId: string,
): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ?",
      )
      .get(ownerId, userId) as { n: number }
  ).n;
}

describe("org member removal — owner_documents cleanup", () => {
  function fixture() {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    return {
      db,
      platformDb,
      orgs: createOrgsRepository(platformDb),
      docs: (ownerId: string, userId: string) =>
        createOwnerDocumentsStore(platformDb, ownerId, userId),
    };
  }

  it("removing a member deletes that member's documents under the org and nobody else's", async () => {
    const f = fixture();
    try {
      const org = await f.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      await f.orgs.addMember(org.id, "member-2", "member");
      await f.orgs.addMember(org.id, "member-3", "member");

      const docs2 = f.docs(org.id, "member-2");
      const docs3 = f.docs(org.id, "member-3");
      const personal2 = f.docs("member-2", "member-2");

      await docs2.put({ kind: "workspace", id: "doc-2a", payload: {} });
      await docs2.put({ kind: "workspace", id: "doc-2b", payload: {} });
      await docs3.put({ kind: "workspace", id: "doc-3a", payload: {} });
      await docs3.put({ kind: "workspace", id: "doc-3b", payload: {} });
      await personal2.put({
        kind: "workspace",
        id: "doc-personal",
        payload: {},
      });

      assert.equal(
        docCount(f.db, org.id, "member-2"),
        2,
        "setup: member-2 has 2 org docs",
      );
      assert.equal(
        docCount(f.db, org.id, "member-3"),
        2,
        "setup: member-3 has 2 org docs",
      );
      assert.equal(
        docCount(f.db, "member-2", "member-2"),
        1,
        "setup: member-2 has 1 personal doc",
      );

      await f.orgs.removeMember(org.id, "member-2", { actorId: "owner-1" });

      assert.equal(
        docCount(f.db, org.id, "member-2"),
        0,
        "removed member's org documents must be gone",
      );
      assert.equal(
        docCount(f.db, org.id, "member-3"),
        2,
        "other member's org documents must remain",
      );
      assert.equal(
        docCount(f.db, "member-2", "member-2"),
        1,
        "removed member's personal documents must remain",
      );
    } finally {
      f.db.close();
    }
  });

  it("deleteOrg with a user id as the org id deletes no personal document", async () => {
    const f = fixture();
    try {
      const userId = "user-self";
      await f.docs(userId, userId).put({
        kind: "workspace",
        id: "doc-personal",
        payload: {},
      });

      // Not an org: no org row is removed, so nothing of this id's may go.
      await f.orgs.deleteOrg(userId, { actorId: userId });

      assert.equal(
        docCount(f.db, userId, userId),
        1,
        "deleteOrg(userId) must not delete personal documents",
      );
    } finally {
      f.db.close();
    }
  });

  it("removeMember with a user id as the org id deletes no personal document", async () => {
    const f = fixture();
    try {
      const userId = "user-self";
      const docs = f.docs(userId, userId);
      await docs.put({ kind: "workspace", id: "doc-personal", payload: {} });

      // No membership row exists for a user id as org_id: changes will be 0,
      // so the delete guard never fires.
      await f.orgs.removeMember(userId, userId);

      assert.equal(
        docCount(f.db, userId, userId),
        1,
        "removeMember(userId, userId) must not delete personal documents",
      );
    } finally {
      f.db.close();
    }
  });

  it("removing someone who is not a member deletes no document", async () => {
    const f = fixture();
    try {
      const org = await f.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      await f.orgs.addMember(org.id, "member-1", "member");

      const docs1 = f.docs(org.id, "member-1");
      await docs1.put({ kind: "workspace", id: "doc-1", payload: {} });

      // A row under the org written by someone with no membership row (the
      // store does not check membership; the route does). The removal must
      // find no membership and so delete nothing, this row included.
      await f.docs(org.id, "stranger").put({
        kind: "workspace",
        id: "doc-s",
        payload: {},
      });

      await f.orgs.removeMember(org.id, "stranger", { actorId: "owner-1" });

      assert.equal(
        docCount(f.db, org.id, "member-1"),
        1,
        "non-member removal must not touch existing documents",
      );
      assert.equal(
        docCount(f.db, org.id, "stranger"),
        1,
        "a removal that removed no membership deletes no document",
      );
    } finally {
      f.db.close();
    }
  });

  it("a removal refused by the last-owner guard deletes no document", async () => {
    const f = fixture();
    try {
      const org = await f.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );

      const docs = f.docs(org.id, "owner-1");
      await docs.put({ kind: "workspace", id: "doc-1", payload: {} });

      await assert.rejects(
        () => f.orgs.removeMember(org.id, "owner-1"),
        LastOwnerError,
      );

      assert.equal(
        docCount(f.db, org.id, "owner-1"),
        1,
        "a refused removal must not delete documents",
      );
    } finally {
      f.db.close();
    }
  });
});

describe("org deletion — owner_documents cleanup", () => {
  function fixture() {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    return {
      db,
      platformDb,
      orgs: createOrgsRepository(platformDb),
      docs: (ownerId: string, userId: string) =>
        createOwnerDocumentsStore(platformDb, ownerId, userId),
    };
  }

  it("deleting an org deletes every document it owns and no other owner's", async () => {
    const f = fixture();
    try {
      const org = await f.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );

      await f.docs(org.id, "user-1").put({
        kind: "workspace",
        id: "doc-1",
        payload: {},
      });
      await f.docs(org.id, "user-2").put({
        kind: "workspace",
        id: "doc-2",
        payload: {},
      });
      // A different tenant's document must survive.
      await f.docs("other-owner", "user-3").put({
        kind: "workspace",
        id: "doc-3",
        payload: {},
      });

      assert.equal(
        docCount(f.db, org.id, "user-1"),
        1,
        "setup: org has 2 docs",
      );
      assert.equal(docCount(f.db, org.id, "user-2"), 1);

      await f.orgs.deleteOrg(org.id, { actorId: "owner-1" });

      assert.equal(
        docCount(f.db, org.id, "user-1"),
        0,
        "deleted org's documents must be gone",
      );
      assert.equal(docCount(f.db, org.id, "user-2"), 0);
      assert.equal(
        docCount(f.db, "other-owner", "user-3"),
        1,
        "another owner's documents must survive",
      );
    } finally {
      f.db.close();
    }
  });

  it("a deletion refused because the org owns projects deletes no document", async () => {
    const f = fixture();
    try {
      const org = await f.orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );

      const projects = createSavedProjectsStore(f.platformDb, org.id);
      await projects.createProjectRecord({
        id: "p-1",
        name: "Project",
        createdAt: 1,
        updatedAt: 1,
        formState: {},
      } as unknown as SavedProject);

      await f.docs(org.id, "user-1").put({
        kind: "workspace",
        id: "doc-1",
        payload: {},
      });

      await assert.rejects(
        () => f.orgs.deleteOrg(org.id, { actorId: "owner-1" }),
        OrgOwnsProjectsError,
      );

      assert.equal(
        docCount(f.db, org.id, "user-1"),
        1,
        "a refused deletion must not delete documents",
      );
    } finally {
      f.db.close();
    }
  });
});
