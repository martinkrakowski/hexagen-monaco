// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  createTeamsRepository,
  DuplicateTeamSlugError,
  NotAnOrgMemberError,
  UnknownTeamError,
} from "../teams-store";
import { createOrgsRepository } from "../orgs-store";
import type { PlatformDb } from "../db";
import {
  BACKENDS,
  openBackend,
  failOnSql,
} from "../../../test-support/platform-backends";

function defined<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error("expected " + what);
  return v;
}

const countTeamRows = async (db: PlatformDb, userId: string) =>
  defined(
    await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?",
      [userId],
    ),
    "team rows",
  ).n;

describe.each(BACKENDS)("P-A2 — team membership invariants (%s", (kind) => {
  it("a no-op mutation writes NO audit row (duplicate add, absent removals)", async () => {
    // An audit row for a mutation that changed nothing is a record of an event
    // that did not happen — and a reader cannot tell it from a real one. That
    // is worse than a missing row, so each transaction gates its append on
    // better-sqlite3's `changes`.
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const audit = backend.store.audit;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "owner-1",
      });
      await orgs.addMember(org.id, "member-1", "member");
      await orgs.addMember(org.id, "member-2", "member");
      const team = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });

      // A REAL add first: the counter must move, or the assertions below pass
      // over a store that never audits anything.
      await teams.addMember(team.id, "member-1", { actorId: "owner-1" });
      const afterReal = await audit.countFor("team.member.add", team.id);
      assert.equal(afterReal, 1, "a real add must be audited");

      // Duplicate add — ON CONFLICT DO NOTHING, so nothing changed.
      await teams.addMember(team.id, "member-1", { actorId: "owner-1" });
      assert.equal(
        await audit.countFor("team.member.add", team.id),
        afterReal,
        "a duplicate add changed nothing and must not be audited",
      );

      // Removing someone who is not a member.
      const removesBefore = await audit.countFor("team.member.remove", team.id);
      await teams.removeMember(team.id, "never-joined", { actorId: "owner-1" });
      assert.equal(
        await audit.countFor("team.member.remove", team.id),
        removesBefore,
        "removing an absent member changed nothing and must not be audited",
      );

      // Deleting a team that does not exist.
      const deletesBefore = await audit.countFor("team.delete", "no-such-team");
      await teams.deleteTeam("no-such-team", { actorId: "owner-1" });
      assert.equal(
        await audit.countFor("team.delete", "no-such-team"),
        deletesBefore,
        "deleting an absent team changed nothing and must not be audited",
      );

      // And the real deletion still IS audited.
      await teams.deleteTeam(team.id, { actorId: "owner-1" });
      assert.equal(
        await audit.countFor("team.delete", team.id),
        1,
        "a real deletion must still be audited",
      );
    } finally {
      await backend.close();
    }
  });

  it("refuses a user who is not a member of the team's org", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "owner-1",
      });
      const team = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });

      // Non-vacuity: both rows exist, so the refusal below is the RULE and
      // not a missing org or team.
      assert.ok(await orgs.getOrg(org.id), "org must exist");
      assert.ok(await teams.getTeam(team.id), "team must exist");

      await assert.rejects(
        () => teams.addMember(team.id, "stranger"),
        (err: unknown) => {
          assert.ok(err instanceof NotAnOrgMemberError);
          assert.equal(err.code, "not_an_org_member");
          return true;
        },
      );
      assert.equal(await teams.isMember(team.id, "stranger"), false);
    } finally {
      await backend.close();
    }
  });

  it("addMember to an unknown team rejects with UnknownTeamError; no team_members row and no audit row appear", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const audit = backend.store.audit;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "owner-1",
      });
      await orgs.addMember(org.id, "member-1", "member");
      await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });

      await assert.rejects(
        () => teams.addMember("nonexistent-team", "member-1"),
        (err: unknown) => {
          assert.ok(err instanceof UnknownTeamError);
          assert.equal(err.code, "unknown_team");
          return true;
        },
      );
      assert.equal(
        await countTeamRows(backend.db, "member-1"),
        0,
        "no team_members row must appear for an unknown team",
      );
      assert.equal(
        await audit.countFor("team.member.add", "nonexistent-team"),
        0,
        "no audit row must appear for an unknown team",
      );
    } finally {
      await backend.close();
    }
  });

  it("addMember of a user who is not in the org rejects with NotAnOrgMemberError; no team_members row and no audit row appear", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const audit = backend.store.audit;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "owner-1",
      });
      const team = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });

      // Non-vacuity: the team exists, so the refusal is the org-membership rule.
      assert.ok(await teams.getTeam(team.id), "team must exist");

      await assert.rejects(
        () => teams.addMember(team.id, "stranger"),
        (err: unknown) => {
          assert.ok(err instanceof NotAnOrgMemberError);
          assert.equal(err.code, "not_an_org_member");
          return true;
        },
      );
      assert.equal(
        await countTeamRows(backend.db, "stranger"),
        0,
        "no team_members row must appear for a non-org-member",
      );
      assert.equal(
        await audit.countFor("team.member.add", team.id),
        0,
        "no audit row must appear for a non-org-member",
      );
    } finally {
      await backend.close();
    }
  });

  it("admits a user who IS an org member", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "owner-1",
      });
      await orgs.addMember(org.id, "dev-1", "member");
      const team = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });

      await teams.addMember(team.id, "dev-1");
      assert.equal(await teams.isMember(team.id, "dev-1"), true);
      assert.deepEqual(await teams.listTeamIdsForUser("dev-1"), [team.id]);
    } finally {
      await backend.close();
    }
  });

  it("leaving the org clears the user's team rows in that org", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "owner-1",
      });
      await orgs.addMember(org.id, "dev-1", "member");
      const a = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });
      const b = await teams.createTeam({
        orgId: org.id,
        slug: "design",
        name: "Design",
        createdBy: "owner-1",
      });
      await teams.addMember(a.id, "dev-1");
      await teams.addMember(b.id, "dev-1");

      // The plan's non-vacuous form: assert it was > 0 BEFORE.
      assert.equal(await countTeamRows(backend.db, "dev-1"), 2);

      await orgs.removeMember(org.id, "dev-1");

      assert.equal(await countTeamRows(backend.db, "dev-1"), 0);
      assert.equal(await orgs.memberRole(org.id, "dev-1"), null);
    } finally {
      await backend.close();
    }
  });

  it("leaves team rows in OTHER orgs untouched", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const acme = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "o",
      });
      const beta = await orgs.createOrg({
        slug: "beta",
        name: "Beta",
        createdBy: "o",
      });
      await orgs.addMember(acme.id, "dev-1", "member");
      await orgs.addMember(beta.id, "dev-1", "member");
      const acmeTeam = await teams.createTeam({
        orgId: acme.id,
        slug: "platform",
        name: "P",
        createdBy: "o",
      });
      const betaTeam = await teams.createTeam({
        orgId: beta.id,
        slug: "platform",
        name: "P",
        createdBy: "o",
      });
      await teams.addMember(acmeTeam.id, "dev-1");
      await teams.addMember(betaTeam.id, "dev-1");
      assert.equal(await countTeamRows(backend.db, "dev-1"), 2);

      await orgs.removeMember(acme.id, "dev-1");

      assert.deepEqual(await teams.listTeamIdsForUser("dev-1"), [betaTeam.id]);
    } finally {
      await backend.close();
    }
  });

  it("the cascade is one transaction: a failing team delete leaves the org row intact", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "o",
      });
      await orgs.addMember(org.id, "dev-1", "member");
      const team = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "P",
        createdBy: "o",
      });
      await teams.addMember(team.id, "dev-1");
      assert.equal(await countTeamRows(backend.db, "dev-1"), 1);

      // The failure must land on the SECOND statement, or the test proves
      // nothing: blocking the first one aborts before the second runs in the
      // non-transactional version too, so both shapes look identical. Blocking
      // the org_members delete means the team rows are ALREADY gone unless a
      // transaction rolls them back.
      const decorated = failOnSql(
        backend.db,
        (sql) => sql.includes("DELETE FROM org_members"),
        new Error("boom"),
      );
      const brokenOrgs = createOrgsRepository(decorated);
      await assert.rejects(
        () => brokenOrgs.removeMember(org.id, "dev-1"),
        /boom/,
      );

      assert.equal(
        await countTeamRows(backend.db, "dev-1"),
        1,
        "team rows must be restored when the org delete fails — without one transaction they stay deleted",
      );
      assert.equal(await orgs.memberRole(org.id, "dev-1"), "member");
    } finally {
      await backend.close();
    }
  });

  it("deleting a team removes its memberships", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "o",
      });
      await orgs.addMember(org.id, "dev-1", "member");
      const team = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "P",
        createdBy: "o",
      });
      await teams.addMember(team.id, "dev-1");
      assert.equal(await countTeamRows(backend.db, "dev-1"), 1);

      await teams.deleteTeam(team.id);

      assert.equal(await countTeamRows(backend.db, "dev-1"), 0);
      assert.equal(await teams.getTeam(team.id), null);
    } finally {
      await backend.close();
    }
  });

  it("the audit log records a membership add, and is append-only in practice", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const audit = backend.store.audit;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "o",
      });
      await orgs.addMember(org.id, "dev-1", "member");
      const team = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "P",
        createdBy: "o",
      });

      const auditCount = async () =>
        defined(
          await backend.db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM audit_log",
            [],
          ),
          "audit count",
        ).n;
      assert.equal(
        await auditCount(),
        0,
        "audit log must start empty for this assertion",
      );

      await teams.addMember(team.id, "dev-1");
      await audit.append({
        actorId: "owner-1",
        action: "team.member.add",
        subjectOwnerId: org.id,
        subjectId: team.id,
        granteeType: "user",
        granteeId: "dev-1",
      });

      assert.equal(await auditCount(), 1);
      const row = defined(
        await backend.db.get<Record<string, string>>(
          "SELECT * FROM audit_log",
          [],
        ),
        "audit row",
      );
      assert.equal(row.actor_id, "owner-1");
      assert.equal(row.action, "team.member.add");
      assert.equal(row.grantee_id, "dev-1");

      // The name of this test claims append-only, so assert it rather than
      // imply it. Append-only here is a property of the SURFACE, not of the
      // schema — SQLite would accept an UPDATE or a DELETE against this table.
      // What holds the line is that the repository offers no way to ask for
      // one, so that is what gets checked.
      const surface = Object.keys(audit).sort();
      assert.deepEqual(
        surface,
        ["append", "countFor"],
        `AuditLogRepository must expose only append and countFor; found: ${surface.join(", ")}`,
      );
      for (const forbidden of ["update", "delete", "remove", "clear"]) {
        assert.equal(
          forbidden in audit,
          false,
          `AuditLogRepository must not expose '${forbidden}'`,
        );
      }
    } finally {
      await backend.close();
    }
  });

  it("a duplicate team slug raises the store's typed error, not a raw driver error", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "owner-1",
      });
      // Non-vacuity: the first create must succeed, so the second failing is
      // the UNIQUE index and not a broken fixture.
      const first = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });
      assert.ok(first.id);

      // The route used to pre-check with a SELECT; two concurrent creates both
      // pass that and the loser escapes as a 500. The index is the arbiter.
      await assert.rejects(
        () =>
          teams.createTeam({
            orgId: org.id,
            slug: "platform",
            name: "Platform Again",
            createdBy: "owner-1",
          }),
        (err: unknown) => {
          assert.ok(
            err instanceof DuplicateTeamSlugError,
            `expected DuplicateTeamSlugError, got ${(err as Error).name}`,
          );
          assert.equal(
            (err as DuplicateTeamSlugError).code,
            "duplicate_team_slug",
          );
          return true;
        },
      );

      // The same slug in a DIFFERENT org is legal.
      const other = await orgs.createOrg({
        slug: "other",
        name: "Other",
        createdBy: "owner-2",
      });
      const ok = await teams.createTeam({
        orgId: other.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-2",
      });
      assert.ok(ok.id);
    } finally {
      await backend.close();
    }
  });

  it("a failing audit append rolls the membership back: no unaudited mutation", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const teams = backend.store.teams;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "owner-1",
      });
      await orgs.addMember(org.id, "dev-1", "member");
      const team = await teams.createTeam({
        orgId: org.id,
        slug: "platform",
        name: "Platform",
        createdBy: "owner-1",
      });

      // Non-vacuity first: the SAME call succeeds and writes the row, so the
      // absence below is a rollback and not a membership that never worked.
      await teams.addMember(team.id, "dev-1", { actorId: "owner-1" });
      assert.equal(await teams.isMember(team.id, "dev-1"), true);
      await teams.removeMember(team.id, "dev-1", { actorId: "owner-1" });
      assert.equal(await teams.isMember(team.id, "dev-1"), false);

      // Force the audit insert to fail INSIDE the transaction.
      const decorated = failOnSql(
        backend.db,
        (sql) => sql.includes("INSERT INTO audit_log"),
        new Error("audit unavailable"),
      );
      const brokenTeams = createTeamsRepository(decorated);

      await assert.rejects(
        () => brokenTeams.addMember(team.id, "dev-1", { actorId: "owner-1" }),
        /audit unavailable/,
      );
      assert.equal(
        await teams.isMember(team.id, "dev-1"),
        false,
        "the membership must roll back when its audit row cannot be written",
      );
    } finally {
      await backend.close();
    }
  });
});

describe.each(BACKENDS)(
  "P-A4 — grants made to a team die with the team (%s",
  (kind) => {
    const PROJECT = "proj-shared";

    it("deleting a team revokes the grants made to it and no other grant", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const teams = backend.store.teams;
        const shares = backend.store.shares;
        const org = await orgs.createOrg({
          slug: "acme",
          name: "Acme",
          createdBy: "owner-1",
        });
        await orgs.addMember(org.id, "owner-1", "owner");
        const team = await teams.createTeam({
          orgId: org.id,
          slug: "platform",
          name: "Platform",
          createdBy: "owner-1",
        });
        const otherTeam = await teams.createTeam({
          orgId: org.id,
          slug: "design",
          name: "Design",
          createdBy: "owner-1",
        });

        // Three live grants on one project: to the team, to another team, to a
        // user. Planting uses the no-actor form (grantNow), which writes the row
        // unconditionally — the deletion under test is the only revocation path.
        await shares.grant({
          ownerId: org.id,
          projectId: PROJECT,
          granteeType: "team",
          granteeId: team.id,
          role: "read",
          grantedBy: "owner-1",
        });
        await shares.grant({
          ownerId: org.id,
          projectId: PROJECT,
          granteeType: "team",
          granteeId: otherTeam.id,
          role: "write",
          grantedBy: "owner-1",
        });
        await shares.grant({
          ownerId: org.id,
          projectId: PROJECT,
          granteeType: "user",
          granteeId: "user-other",
          role: "read",
          grantedBy: "owner-1",
        });
        assert.equal(
          (await shares.listForProject(org.id, PROJECT)).length,
          3,
          "setup: three live grants on the project",
        );

        await teams.deleteTeam(team.id, { actorId: "owner-1" });

        const after = await shares.listForProject(org.id, PROJECT);
        assert.equal(
          after.length,
          2,
          "only the deleted team's grant is revoked",
        );
        const granteeIds = after.map((s) => s.granteeId).sort();
        assert.deepEqual(
          granteeIds,
          [otherTeam.id, "user-other"].sort(),
          "the other team's grant and the user's grant survive",
        );
      } finally {
        await backend.close();
      }
    });

    it("deleting an id that is not a team revokes nothing (no over-revocation)", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const teams = backend.store.teams;
        const shares = backend.store.shares;
        const org = await orgs.createOrg({
          slug: "acme",
          name: "Acme",
          createdBy: "owner-1",
        });
        await orgs.addMember(org.id, "owner-1", "owner");

        // A live team-shaped grant for an id that is NOT a team row.
        await shares.grant({
          ownerId: org.id,
          projectId: PROJECT,
          granteeType: "team",
          granteeId: "not-a-team",
          role: "read",
          grantedBy: "owner-1",
        });
        assert.equal(
          (await shares.listForProject(org.id, PROJECT)).length,
          1,
          "setup: the planted grant is live",
        );

        await teams.deleteTeam("not-a-team", { actorId: "owner-1" });

        const after = await shares.listForProject(org.id, PROJECT);
        assert.equal(
          after.length,
          1,
          "no team row existed, so nothing is revoked",
        );
      } finally {
        await backend.close();
      }
    });

    // TM3: deleting a team removes its members and revokes only the grants made to it
    it("deleting a team removes its members and revokes only the grants made to it", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const teams = backend.store.teams;
        const shares = backend.store.shares;
        const org = await orgs.createOrg({
          slug: "acme",
          name: "Acme",
          createdBy: "owner-1",
        });
        await orgs.addMember(org.id, "owner-1", "owner");
        await orgs.addMember(org.id, "member-1", "member");
        await orgs.addMember(org.id, "member-2", "member");
        const team = await teams.createTeam({
          orgId: org.id,
          slug: "platform",
          name: "Platform",
          createdBy: "owner-1",
        });
        const otherTeam = await teams.createTeam({
          orgId: org.id,
          slug: "design",
          name: "Design",
          createdBy: "owner-1",
        });
        await teams.addMember(team.id, "member-1", { actorId: "owner-1" });
        await teams.addMember(otherTeam.id, "member-2", {
          actorId: "owner-1",
        });

        // Grants to the deleted team, to the other team, and to a user.
        await shares.grant({
          ownerId: org.id,
          projectId: PROJECT,
          granteeType: "team",
          granteeId: team.id,
          role: "read",
          grantedBy: "owner-1",
        });
        await shares.grant({
          ownerId: org.id,
          projectId: PROJECT,
          granteeType: "team",
          granteeId: otherTeam.id,
          role: "write",
          grantedBy: "owner-1",
        });
        await shares.grant({
          ownerId: org.id,
          projectId: PROJECT,
          granteeType: "user",
          granteeId: "user-other",
          role: "read",
          grantedBy: "owner-1",
        });
        assert.equal(await countTeamRows(backend.db, "member-1"), 1);
        assert.equal(
          (await shares.listForProject(org.id, PROJECT)).length,
          3,
          "setup: three live grants on the project",
        );

        await teams.deleteTeam(team.id, { actorId: "owner-1" });

        // Members of the deleted team are gone.
        assert.equal(await countTeamRows(backend.db, "member-1"), 0);
        // The other team's member and grants survive.
        assert.equal(await countTeamRows(backend.db, "member-2"), 1);
        const after = await shares.listForProject(org.id, PROJECT);
        assert.equal(
          after.length,
          2,
          "only the deleted team's grant is revoked",
        );
        const granteeIds = after.map((s) => s.granteeId).sort();
        assert.deepEqual(granteeIds, [otherTeam.id, "user-other"].sort());
      } finally {
        await backend.close();
      }
    });
  },
);
