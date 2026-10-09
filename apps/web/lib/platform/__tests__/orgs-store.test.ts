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
import type { PlatformDb, SqlValue } from "../db";
import { ORG_INVITE_TTL_MS } from "../platform-db";

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

const count = async (db: PlatformDb, sql: string, ...args: SqlValue[]) =>
  defined(await db.get<{ n: number }>(sql, args), "count").n;

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

describe.each(BACKENDS)(
  "OrgsRepository.invite — timestamp shape (%s",
  (kind) => {
    it("OR2 invite timestamps are ISO strings for the right instants", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const org = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        const before = Date.now();
        const invite = await orgs.invite(org.id, "ada", "member", {
          actorId: "owner-1",
        });
        const after = Date.now();

        // Strings, not Date objects or numbers: a type leaking through here would
        // break the instant comparisons every other seam makes on these values.
        assert.equal(typeof invite.createdAt, "string");
        assert.equal(typeof invite.expiresAt, "string");
        assert.equal(invite.acceptedAt, null);

        const createdMs = new Date(invite.createdAt).getTime();
        assert.ok(
          Number.isFinite(createdMs),
          "createdAt is a parseable instant",
        );
        assert.ok(
          createdMs >= before - 5_000 && createdMs <= after + 5_000,
          "createdAt is the instant of the invite",
        );
        const expiresMs = new Date(invite.expiresAt).getTime();
        assert.ok(
          Number.isFinite(expiresMs),
          "expiresAt is a parseable instant",
        );
        assert.ok(
          Math.abs(expiresMs - createdMs - ORG_INVITE_TTL_MS) < 5_000,
          "expiresAt is ORG_INVITE_TTL_DAYS after createdAt",
        );

        const joined = await orgs.acceptInvitesForLogin("ada-user", "ada");
        assert.deepEqual(joined, [org.id]);

        const members = await orgs.listMembers(org.id);
        const member = defined(
          members.find((m) => m.userId === "ada-user"),
          "accepted invite member",
        );
        assert.equal(typeof member.createdAt, "string");
        // Parsing must not throw and must yield a finite instant.
        assert.ok(
          Number.isFinite(new Date(member.createdAt).getTime()),
          "listMembers createdAt is an ISO instant",
        );
      } finally {
        await backend.close();
      }
    });
  },
);

describe.each(BACKENDS)("OrgsRepository.listPendingInvites (%s", (kind) => {
  it("OR3 pending lists: unaccepted and unexpired only, this org's only, ordered by login", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const acme = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      const beta = await orgs.createOrgWithOwner(
        { slug: "beta", name: "Beta", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      const audit = { actorId: "owner-1" };
      // Three in org A (one accepted, one backdated-expired, one live) plus two
      // more live; one live in org B to pin the org_id term.
      await orgs.invite(acme.id, "accepted", "member", audit);
      await orgs.invite(acme.id, "backdated", "member", audit);
      await orgs.invite(acme.id, "live", "member", audit);
      await orgs.invite(acme.id, "amy", "member", audit);
      await orgs.invite(acme.id, "zoe", "member", audit);
      await orgs.invite(beta.id, "live", "member", audit);

      const joined = await orgs.acceptInvitesForLogin(
        "user-accepted",
        "accepted",
      );
      assert.deepEqual(joined, [acme.id]);

      // Push the "backdated" invite into the past so expires_at > @now drops it.
      const pastMs = Date.now() - 3_600_000;
      await backend.db.run(
        "UPDATE org_invites SET expires_at = hx_ts(?) WHERE org_id = ? AND github_login = ?",
        [pastMs, acme.id, "backdated"],
      );

      const acmePending = await orgs.listPendingInvites(acme.id);
      // accepted excluded (accepted_at IS NULL); backdated excluded (expires_at >
      // @now); beta's invite excluded (org_id term); remainder ordered by login.
      assert.deepEqual(
        acmePending.map((i) => i.githubLogin),
        ["amy", "live", "zoe"],
      );
      assert.deepEqual(
        (await orgs.listPendingInvites(beta.id)).map((i) => i.githubLogin),
        ["live"],
      );
    } finally {
      await backend.close();
    }
  });
});

describe.each(BACKENDS)("OrgsRepository.changeMemberRole (%s", (kind) => {
  it("OR4 changeMemberRole touches only the named member of the named org", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const acme = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      const beta = await orgs.createOrgWithOwner(
        { slug: "beta", name: "Beta", createdBy: "owner-1" },
        { actorId: "owner-1" },
      );
      const audit = { actorId: "owner-1" };
      await orgs.addMember(acme.id, "u", "member", audit);
      await orgs.addMember(beta.id, "u", "member", audit);
      await orgs.addMember(acme.id, "other", "member", audit);

      const role = async (orgId: string, userId: string) =>
        defined(
          await backend.db.get<{ role: string }>(
            "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?",
            [orgId, userId],
          ),
          "member row",
        ).role;

      const changed = await orgs.changeMemberRole(acme.id, "u", "owner", audit);
      assert.equal(changed, true, "a real role change reports true");
      assert.equal(await role(acme.id, "u"), "owner");
      assert.equal(
        await role(acme.id, "other"),
        "member",
        "the other member of org 1 is untouched",
      );
      assert.equal(
        await role(beta.id, "u"),
        "member",
        "the same user in org 2 is untouched",
      );

      // An unknown org id returns false and creates no membership row.
      const noop = await orgs.changeMemberRole("nope-org", "u", "owner", audit);
      assert.equal(noop, false, "an unknown org id is not a member");
      assert.equal(await orgs.memberRole("nope-org", "u"), null);
      assert.equal(
        await count(
          backend.db,
          "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND user_id = ?",
          "nope-org",
          "u",
        ),
        0,
        "no row is created for an unknown org id",
      );
    } finally {
      await backend.close();
    }
  });
});

describe.each(BACKENDS)(
  "OrgsRepository.removeMember — team and document scoping (%s",
  (kind) => {
    it("OR6 removing a member clears only that org's team rows and documents", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const teams = backend.store.teams;
        const docs = (ownerId: string, userId: string) =>
          backend.store.documentsFor(ownerId, userId);
        const audit = { actorId: "owner-1" };
        // row count shorthand
        const n = (sql: string, ...args: SqlValue[]) =>
          count(backend.db, sql, ...args);

        const acme = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        const beta = await orgs.createOrgWithOwner(
          { slug: "beta", name: "Beta", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        await orgs.addMember(acme.id, "u", "member", audit);
        await orgs.addMember(beta.id, "u", "member", audit);
        const team1 = await teams.createTeam({
          orgId: acme.id,
          slug: "t1",
          name: "T1",
          createdBy: "owner-1",
        });
        const team2 = await teams.createTeam({
          orgId: beta.id,
          slug: "t2",
          name: "T2",
          createdBy: "owner-1",
        });
        await teams.addMember(team1.id, "u", audit);
        await teams.addMember(team2.id, "u", audit);
        must(
          await docs(acme.id, "u").put({
            kind: "workspace",
            id: "doc-1",
            payload: {},
          }),
        );
        must(
          await docs(beta.id, "u").put({
            kind: "workspace",
            id: "doc-2",
            payload: {},
          }),
        );

        // Non-vacuity: org 2's membership, its team row and its document exist.
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND user_id = ?",
            beta.id,
            "u",
          ),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND user_id = ?",
            team2.id,
            "u",
          ),
          1,
        );
        assert.equal(await docCount(backend.db, beta.id, "u"), 1);

        await orgs.removeMember(acme.id, "u", audit);

        // Org 1's team rows and documents are cleared...
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND user_id = ?",
            acme.id,
            "u",
          ),
          0,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND user_id = ?",
            team1.id,
            "u",
          ),
          0,
        );
        assert.equal(await docCount(backend.db, acme.id, "u"), 0);
        // ...and org 2's membership, team row and document survive.
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND user_id = ?",
            beta.id,
            "u",
          ),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND user_id = ?",
            team2.id,
            "u",
          ),
          1,
        );
        assert.equal(await docCount(backend.db, beta.id, "u"), 1);
      } finally {
        await backend.close();
      }
    });
  },
);

describe.each(BACKENDS)(
  "OrgsRepository.deleteOrg — tenancy scoping (%s",
  (kind) => {
    it("OR7 deleteOrg removes only this org's rows", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const teams = backend.store.teams;
        const shares = backend.store.shares;
        const audit = { actorId: "owner-1" };
        const n = (sql: string, ...args: SqlValue[]) =>
          count(backend.db, sql, ...args);
        const insertRun = `INSERT INTO run_events (id, owner_id, run_id, stage, label, duration_ms,
  retry_count, input_tokens, output_tokens, served_from_cache, used_llm,
  summary, created_at)
VALUES (?, ?, ?, 0, 'stage-0', 1, 0, 0, 0, ?, ?, 's', hx_ts(?))`;

        // Two orgs, each seeded: owner + member, a team + its member, a pending
        // invite, a grant where the org is the grantee, and a run event.
        const org1 = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        const team1 = await teams.createTeam({
          orgId: org1.id,
          slug: "acme",
          name: "Acme",
          createdBy: "owner-1",
        });
        await orgs.addMember(org1.id, "member-1", "member", audit);
        await teams.addMember(team1.id, "member-1", audit);
        await orgs.invite(org1.id, "someone", "member", audit);
        await shares.grant({
          ownerId: "other-user",
          projectId: "their-project",
          granteeType: "org",
          granteeId: org1.id,
          role: "read",
          grantedBy: "other-user",
        });
        await backend.db.run(insertRun, [
          "evt-acme",
          org1.id,
          "run-1",
          0,
          0,
          Date.now(),
        ]);
        const org2 = await orgs.createOrgWithOwner(
          { slug: "beta", name: "Beta", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        const team2 = await teams.createTeam({
          orgId: org2.id,
          slug: "beta",
          name: "Beta",
          createdBy: "owner-1",
        });
        await orgs.addMember(org2.id, "member-1", "member", audit);
        await teams.addMember(team2.id, "member-1", audit);
        await orgs.invite(org2.id, "someone", "member", audit);
        await shares.grant({
          ownerId: "other-user",
          projectId: "their-project",
          granteeType: "org",
          granteeId: org2.id,
          role: "read",
          grantedBy: "other-user",
        });
        await backend.db.run(insertRun, [
          "evt-beta",
          org2.id,
          "run-1",
          0,
          0,
          Date.now(),
        ]);

        // Non-vacuity: every class the deletion touches exists for org 2 before.
        const liveGrants = (orgId: string) =>
          n(
            "SELECT COUNT(*) AS n FROM project_shares WHERE grantee_type = 'org' AND grantee_id = ? AND revoked_at IS NULL",
            orgId,
          );
        const totalGrants = (orgId: string) =>
          n(
            "SELECT COUNT(*) AS n FROM project_shares WHERE grantee_type = 'org' AND grantee_id = ?",
            orgId,
          );
        assert.equal(
          await n("SELECT COUNT(*) AS n FROM orgs WHERE id = ?", org2.id),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
            org2.id,
          ),
          2,
        );
        assert.equal(
          await n("SELECT COUNT(*) AS n FROM teams WHERE org_id = ?", org2.id),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
            team2.id,
          ),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ?",
            org2.id,
          ),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM run_events WHERE owner_id = ?",
            org2.id,
          ),
          1,
        );
        assert.equal(await liveGrants(org2.id), 1);
        assert.equal(typeof (await liveGrants(org2.id)), "number");

        await orgs.deleteOrg(org1.id, { actorId: "owner-1" });

        // Org 2 is untouched across every row class.
        assert.equal(
          await n("SELECT COUNT(*) AS n FROM orgs WHERE id = ?", org2.id),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
            org2.id,
          ),
          2,
        );
        assert.equal(
          await n("SELECT COUNT(*) AS n FROM teams WHERE org_id = ?", org2.id),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
            team2.id,
          ),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ?",
            org2.id,
          ),
          1,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM run_events WHERE owner_id = ?",
            org2.id,
          ),
          1,
        );
        assert.equal(
          await liveGrants(org2.id),
          1,
          "org 2's grant must survive",
        );

        // Org 1 is gone or soft-revoked across every row class.
        assert.equal(
          await n("SELECT COUNT(*) AS n FROM orgs WHERE id = ?", org1.id),
          0,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
            org1.id,
          ),
          0,
        );
        assert.equal(
          await n("SELECT COUNT(*) AS n FROM teams WHERE org_id = ?", org1.id),
          0,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
            team1.id,
          ),
          0,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ?",
            org1.id,
          ),
          0,
        );
        assert.equal(
          await n(
            "SELECT COUNT(*) AS n FROM run_events WHERE owner_id = ?",
            org1.id,
          ),
          0,
        );
        assert.equal(await liveGrants(org1.id), 0, "org 1's grant is revoked");
        assert.equal(
          await totalGrants(org1.id),
          1,
          "grant row survives as audit trail",
        );
      } finally {
        await backend.close();
      }
    });
  },
);

describe.each(BACKENDS)(
  "OrgsRepository.changeMemberRole — last-owner guard under concurrency (%s",
  (kind) => {
    it("OR5 two owners demoted at the same time leave one owner", async () => {
      // pgMax: 6 so the two transactions actually run concurrently on the
      // Postgres pool rather than serialising like SQLite; the SERIALIZABLE
      // retry is what makes the count check hold.
      const backend = await openBackend(kind, { pgMax: 6 });
      try {
        const orgs = backend.store.orgs;
        const audit = { actorId: "owner-1" };
        const n = (sql: string, ...args: SqlValue[]) =>
          count(backend.db, sql, ...args);
        const countOwners = (orgId: string) =>
          n(
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'owner'",
            orgId,
          );

        const org = await orgs.createOrgWithOwner(
          { slug: "acme", name: "Acme", createdBy: "owner-1" },
          { actorId: "owner-1" },
        );
        await orgs.addMember(org.id, "owner-2", "owner", audit);
        // Non-vacuity: two owners before the race.
        assert.equal(await countOwners(org.id), 2);

        // Demote both owners together. Under SERIALIZABLE both read count=2, the
        // loser is retried and re-reads count=1, and guardLastOwner throws. On
        // SQLite the single connection serialises the two transactions, so the
        // second re-reads the committed count and throws the same way. Either
        // valid order leaves exactly one owner.
        const results = await Promise.allSettled([
          orgs.changeMemberRole(org.id, "owner-1", "member", audit),
          orgs.changeMemberRole(org.id, "owner-2", "member", audit),
        ]);

        let resolved = 0;
        let refused = 0;
        for (const r of results) {
          if (r.status === "fulfilled") {
            assert.equal(r.value, true, "the winning demotion reports true");
            resolved++;
          } else {
            assert.ok(
              r.reason instanceof LastOwnerError,
              "the loser is refused as the last owner",
            );
            refused++;
          }
        }
        assert.equal(resolved, 1, "exactly one demotion succeeded");
        assert.equal(refused, 1, "exactly one demotion was refused");
        assert.equal(
          typeof (await countOwners(org.id)),
          "number",
          "counts are numbers on both backends",
        );
        assert.equal(
          await countOwners(org.id),
          1,
          "exactly one owner remains afterwards",
        );
      } finally {
        await backend.close();
      }
    });
  },
);
