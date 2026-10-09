// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  DuplicateOrgSlugError,
  LastOwnerError,
  OrgOwnsProjectsError,
} from "../orgs-store";
import type { SavedProject } from "@hexagen/shared";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
import type { PlatformDb } from "../db";

function defined<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error("expected " + what);
  return v;
}

function must<T>(
  r: { success: true; value: T } | { success: false; error: unknown },
): T {
  if (!r.success)
    throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  return r.value;
}

const docCount = async (db: PlatformDb, ownerId: string, userId: string) =>
  defined(
    await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ?",
      [ownerId, userId],
    ),
    "document count",
  ).n;

describe.each(BACKENDS)("OrgsRepository.listOrgsForUser (%s", (kind) => {
  it("returns this caller's orgs with roles, and nobody else's", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const acme = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      const beta = await orgs.createOrg({
        slug: "beta",
        name: "Beta",
        createdBy: "user-2",
      });
      await orgs.addMember(acme.id, "user-1", "owner");
      await orgs.addMember(acme.id, "user-2", "member");
      await orgs.addMember(beta.id, "user-2", "owner");

      const forUser1 = await orgs.listOrgsForUser("user-1");
      assert.equal(forUser1.length, 1);
      assert.equal(forUser1[0]?.id, acme.id);
      assert.equal(forUser1[0]?.slug, "acme");
      assert.equal(forUser1[0]?.name, "Acme");
      assert.equal(forUser1[0]?.role, "owner");

      const forUser2 = await orgs.listOrgsForUser("user-2");
      assert.equal(forUser2.length, 2);
      const bySlug = Object.fromEntries(forUser2.map((o) => [o.slug, o.role]));
      assert.equal(bySlug.acme, "member");
      assert.equal(bySlug.beta, "owner");

      const forStranger = await orgs.listOrgsForUser("nobody");
      assert.equal(forStranger.length, 0);
    } finally {
      await backend.close();
    }
  });
});

describe.each(BACKENDS)("OrgsRepository — typed error refusals (%s", (kind) => {
  it("createOrgWithOwner with a taken slug rejects with DuplicateOrgSlugError and leaves no second org, no membership and no audit row", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const org = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      // Non-vacuity: "other" has no orgs yet.
      assert.equal((await orgs.listOrgsForUser("other")).length, 0);

      await assert.rejects(
        () =>
          orgs.createOrgWithOwner(
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
        (await orgs.listOrgsForUser("other")).length,
        0,
        "the failed create must not list an org for the second user",
      );
      // No membership for "other" in the org.
      assert.equal(
        await orgs.memberRole(org.id, "other"),
        null,
        "the failed create must not add a membership",
      );
      // No second audit row: the original org.create is the only one.
      assert.equal(
        await backend.store.audit.countFor("org.create", org.id),
        1,
        "the failed create must not write an audit row",
      );
    } finally {
      await backend.close();
    }
  });

  it("demoting or removing the last owner rejects with LastOwnerError and the member stays an owner", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const org = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      // Demoting: founder is the only owner, so demotion to member must refuse.
      await assert.rejects(
        () => orgs.addMember(org.id, "founder", "member"),
        (err: unknown) => {
          assert.ok(err instanceof LastOwnerError);
          return true;
        },
      );
      // The founder is still an owner — the refusal rolled back.
      assert.equal(await orgs.memberRole(org.id, "founder"), "owner");

      // Removing the last owner must also refuse.
      await assert.rejects(
        () => orgs.removeMember(org.id, "founder"),
        (err: unknown) => {
          assert.ok(err instanceof LastOwnerError);
          return true;
        },
      );
      assert.equal(await orgs.memberRole(org.id, "founder"), "owner");
    } finally {
      await backend.close();
    }
  });

  it("deleteOrg of an org that owns a project rejects with OrgOwnsProjectsError; org, members and teams survive", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const org = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      await orgs.addMember(org.id, "member-1", "member");
      const team = await backend.store.teams.createTeam({
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
      must(
        await backend.store.projectsFor(org.id).createProjectRecord(project),
      );

      await assert.rejects(
        () => orgs.deleteOrg(org.id, { actorId: "owner-1" }),
        (err: unknown) => {
          assert.ok(err instanceof OrgOwnsProjectsError);
          return true;
        },
      );

      // Org survives.
      assert.ok(await orgs.getOrg(org.id), "org must survive the refusal");
      // Member survives.
      assert.equal(
        await orgs.memberRole(org.id, "member-1"),
        "member",
        "member must survive the refusal",
      );
      // Team survives.
      const teams = await backend.store.teams.listTeamsForOrg(org.id);
      assert.equal(teams.length, 1, "team must survive the refusal");
      assert.equal(teams[0]?.id, team.id);
    } finally {
      await backend.close();
    }
  });
});

describe.each(BACKENDS)("OrgsRepository.acceptInvitesForLogin (%s", (kind) => {
  it("accepts only the signing-in login's invites, and leaves every other pending invite pending", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const acme = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      const beta = await orgs.createOrg({
        slug: "beta",
        name: "Beta",
        createdBy: "user-1",
      });
      const audit = { actorId: "user-1" };
      await orgs.invite(acme.id, "ada", "member", audit);
      await orgs.invite(acme.id, "grace", "member", audit);
      await orgs.invite(beta.id, "grace", "owner", audit);

      const joined = await orgs.acceptInvitesForLogin("ada-user", "ada");
      assert.deepEqual(joined, [acme.id]);

      // The UPDATE that stamps an invite accepted is keyed by org AND login.
      // Without that key it would stamp every invite in the table.
      const acmePending = await orgs.listPendingInvites(acme.id);
      assert.deepEqual(
        acmePending.map((i) => i.githubLogin),
        ["grace"],
      );
      const betaPending = await orgs.listPendingInvites(beta.id);
      assert.deepEqual(
        betaPending.map((i) => i.githubLogin),
        ["grace"],
      );

      const later = await orgs.acceptInvitesForLogin("grace-user", "grace");
      assert.deepEqual([...later].sort(), [acme.id, beta.id].sort());
      assert.equal(await orgs.memberRole(beta.id, "grace-user"), "owner");
    } finally {
      await backend.close();
    }
  });
});

describe.each(BACKENDS)(
  "org member removal — owner_documents cleanup (%s",
  (kind) => {
    it("removing a member deletes that member's documents under the org and nobody else's", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const docs = (ownerId: string, userId: string) =>
          backend.store.documentsFor(ownerId, userId);

        const org = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        await orgs.addMember(org.id, "member-2", "member");
        await orgs.addMember(org.id, "member-3", "member");

        const docs2 = docs(org.id, "member-2");
        const docs3 = docs(org.id, "member-3");
        const personal2 = docs("member-2", "member-2");

        must(await docs2.put({ kind: "workspace", id: "doc-2a", payload: {} }));
        must(await docs2.put({ kind: "workspace", id: "doc-2b", payload: {} }));
        must(await docs3.put({ kind: "workspace", id: "doc-3a", payload: {} }));
        must(await docs3.put({ kind: "workspace", id: "doc-3b", payload: {} }));
        must(
          await personal2.put({
            kind: "workspace",
            id: "doc-personal",
            payload: {},
          }),
        );

        assert.equal(
          await docCount(backend.db, org.id, "member-2"),
          2,
          "setup: member-2 has 2 org docs",
        );
        assert.equal(
          await docCount(backend.db, org.id, "member-3"),
          2,
          "setup: member-3 has 2 org docs",
        );
        assert.equal(
          await docCount(backend.db, "member-2", "member-2"),
          1,
          "setup: member-2 has 1 personal doc",
        );

        await orgs.removeMember(org.id, "member-2", { actorId: "owner-1" });

        assert.equal(
          await docCount(backend.db, org.id, "member-2"),
          0,
          "removed member's org documents must be gone",
        );
        assert.equal(
          await docCount(backend.db, org.id, "member-3"),
          2,
          "other member's org documents must remain",
        );
        assert.equal(
          await docCount(backend.db, "member-2", "member-2"),
          1,
          "removed member's personal documents must remain",
        );
      } finally {
        await backend.close();
      }
    });

    it("deleteOrg with a user id as the org id deletes no personal document", async () => {
      const backend = await openBackend(kind);
      try {
        const userId = "user-self";
        const docs = backend.store.documentsFor(userId, userId);
        must(
          await docs.put({
            kind: "workspace",
            id: "doc-personal",
            payload: {},
          }),
        );

        await backend.store.orgs.deleteOrg(userId, { actorId: userId });

        assert.equal(
          await docCount(backend.db, userId, userId),
          1,
          "deleteOrg(userId) must not delete personal documents",
        );
      } finally {
        await backend.close();
      }
    });

    it("removeMember with a user id as the org id deletes no personal document", async () => {
      const backend = await openBackend(kind);
      try {
        const userId = "user-self";
        const docs = backend.store.documentsFor(userId, userId);
        must(
          await docs.put({
            kind: "workspace",
            id: "doc-personal",
            payload: {},
          }),
        );

        await backend.store.orgs.removeMember(userId, userId);

        assert.equal(
          await docCount(backend.db, userId, userId),
          1,
          "removeMember(userId, userId) must not delete personal documents",
        );
      } finally {
        await backend.close();
      }
    });

    it("removing someone who is not a member deletes no document", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const docs = (ownerId: string, userId: string) =>
          backend.store.documentsFor(ownerId, userId);

        const org = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        await orgs.addMember(org.id, "member-1", "member");

        const docs1 = docs(org.id, "member-1");
        must(await docs1.put({ kind: "workspace", id: "doc-1", payload: {} }));

        await backend.db.run(
          `INSERT INTO owner_documents
          (owner_id, user_id, kind, id, rev, payload, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, hx_ts(?))`,
          [org.id, "stranger", "workspace", "doc-s", "{}", Date.now()],
        );

        await orgs.removeMember(org.id, "stranger", { actorId: "owner-1" });

        assert.equal(
          await docCount(backend.db, org.id, "member-1"),
          1,
          "non-member removal must not touch existing documents",
        );
        assert.equal(
          await docCount(backend.db, org.id, "stranger"),
          1,
          "a removal that removed no membership deletes no document",
        );
      } finally {
        await backend.close();
      }
    });

    it("a removal refused by the last-owner guard deletes no document", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const docs = (ownerId: string, userId: string) =>
          backend.store.documentsFor(ownerId, userId);

        const org = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );

        const doc = docs(org.id, "owner-1");
        must(await doc.put({ kind: "workspace", id: "doc-1", payload: {} }));

        await assert.rejects(
          () => orgs.removeMember(org.id, "owner-1"),
          LastOwnerError,
        );

        assert.equal(
          await docCount(backend.db, org.id, "owner-1"),
          1,
          "a refused removal must not delete documents",
        );
      } finally {
        await backend.close();
      }
    });
  },
);

describe.each(BACKENDS)(
  "org deletion — owner_documents cleanup (%s",
  (kind) => {
    it("deleting an org deletes every document it owns and no other owner's", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const docs = (ownerId: string, userId: string) =>
          backend.store.documentsFor(ownerId, userId);

        const org = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        await orgs.addMember(org.id, "user-1", "member");
        await orgs.addMember(org.id, "user-2", "member");

        must(
          await docs(org.id, "user-1").put({
            kind: "workspace",
            id: "doc-1",
            payload: {},
          }),
        );
        must(
          await docs(org.id, "user-2").put({
            kind: "workspace",
            id: "doc-2",
            payload: {},
          }),
        );
        // A different tenant's document must survive. Personal tenant: owner === author.
        must(
          await docs("user-3", "user-3").put({
            kind: "workspace",
            id: "doc-3",
            payload: {},
          }),
        );

        assert.equal(
          await docCount(backend.db, org.id, "user-1"),
          1,
          "setup: org has 2 docs",
        );
        assert.equal(await docCount(backend.db, org.id, "user-2"), 1);

        await orgs.deleteOrg(org.id, { actorId: "owner-1" });

        assert.equal(
          await docCount(backend.db, org.id, "user-1"),
          0,
          "deleted org's documents must be gone",
        );
        assert.equal(await docCount(backend.db, org.id, "user-2"), 0);
        assert.equal(
          await docCount(backend.db, "user-3", "user-3"),
          1,
          "another owner's documents must survive",
        );
      } finally {
        await backend.close();
      }
    });

    it("a deletion refused because the org owns projects deletes no document", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const docs = (ownerId: string, userId: string) =>
          backend.store.documentsFor(ownerId, userId);

        const org = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        await orgs.addMember(org.id, "user-1", "member");

        must(
          await backend.store.projectsFor(org.id).createProjectRecord({
            id: "p-1",
            name: "Project",
            createdAt: 1,
            updatedAt: 1,
            formState: {},
          } as unknown as SavedProject),
        );

        must(
          await docs(org.id, "user-1").put({
            kind: "workspace",
            id: "doc-1",
            payload: {},
          }),
        );

        await assert.rejects(
          () => orgs.deleteOrg(org.id, { actorId: "owner-1" }),
          OrgOwnsProjectsError,
        );

        assert.equal(
          await docCount(backend.db, org.id, "user-1"),
          1,
          "a refused deletion must not delete documents",
        );
      } finally {
        await backend.close();
      }
    });
  },
);
