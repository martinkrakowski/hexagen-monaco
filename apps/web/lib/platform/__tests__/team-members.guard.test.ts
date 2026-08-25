import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openPlatformDb } from "../platform-db";
import { createOrgsRepository } from "../orgs-store";
import { createTeamsRepository, NotAnOrgMemberError } from "../teams-store";
import { createAuditLogRepository } from "../audit-log-store";

function fixture() {
  const path = join(
    mkdtempSync(join(tmpdir(), "hexagen-team-members-")),
    "p.db",
  );
  const db = openPlatformDb(path);
  return {
    db,
    orgs: createOrgsRepository(db),
    teams: createTeamsRepository(db),
    audit: createAuditLogRepository(db),
  };
}

const countTeamRows = (db: ReturnType<typeof fixture>["db"], userId: string) =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?")
      .get(userId) as { n: number }
  ).n;

describe("P-A2 — team membership invariants", () => {
  it("refuses a user who is not a member of the team's org", async () => {
    const { db, orgs, teams } = fixture();
    try {
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
      db.close();
    }
  });

  it("admits a user who IS an org member", async () => {
    const { db, orgs, teams } = fixture();
    try {
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
      db.close();
    }
  });

  it("leaving the org clears the user's team rows in that org", async () => {
    const { db, orgs, teams } = fixture();
    try {
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
      assert.equal(countTeamRows(db, "dev-1"), 2);

      await orgs.removeMember(org.id, "dev-1");

      assert.equal(countTeamRows(db, "dev-1"), 0);
      assert.equal(await orgs.memberRole(org.id, "dev-1"), null);
    } finally {
      db.close();
    }
  });

  it("leaves team rows in OTHER orgs untouched", async () => {
    const { db, orgs, teams } = fixture();
    try {
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
      assert.equal(countTeamRows(db, "dev-1"), 2);

      await orgs.removeMember(acme.id, "dev-1");

      assert.deepEqual(await teams.listTeamIdsForUser("dev-1"), [betaTeam.id]);
    } finally {
      db.close();
    }
  });

  it("the cascade is one transaction: a failing team delete leaves the org row intact", async () => {
    const { db, orgs, teams } = fixture();
    try {
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
      assert.equal(countTeamRows(db, "dev-1"), 1);

      // The failure must land on the SECOND statement, or the test proves
      // nothing: blocking the first one aborts before the second runs in the
      // non-transactional version too, so both shapes look identical. Blocking
      // the org_members delete means the team rows are ALREADY gone unless a
      // transaction rolls them back.
      db.exec(`
        CREATE TRIGGER org_members_block_delete
        BEFORE DELETE ON org_members
        BEGIN SELECT RAISE(ABORT, 'blocked'); END;
      `);
      await assert.rejects(() => orgs.removeMember(org.id, "dev-1"), /blocked/);

      assert.equal(
        countTeamRows(db, "dev-1"),
        1,
        "team rows must be restored when the org delete fails — without one transaction they stay deleted",
      );
      assert.equal(await orgs.memberRole(org.id, "dev-1"), "member");
      db.exec("DROP TRIGGER org_members_block_delete");
    } finally {
      db.close();
    }
  });

  it("deleting a team removes its memberships", async () => {
    const { db, orgs, teams } = fixture();
    try {
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
      assert.equal(countTeamRows(db, "dev-1"), 1);

      await teams.deleteTeam(team.id);

      assert.equal(countTeamRows(db, "dev-1"), 0);
      assert.equal(await teams.getTeam(team.id), null);
    } finally {
      db.close();
    }
  });

  it("the audit log records a membership add, and is append-only in practice", async () => {
    const { db, orgs, teams, audit } = fixture();
    try {
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

      const count = () =>
        (
          db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as {
            n: number;
          }
        ).n;
      assert.equal(count(), 0, "audit log must start empty for this assertion");

      await teams.addMember(team.id, "dev-1");
      await audit.append({
        actorId: "owner-1",
        action: "team.member.add",
        subjectOwnerId: org.id,
        subjectId: team.id,
        granteeType: "user",
        granteeId: "dev-1",
      });

      assert.equal(count(), 1);
      const row = db.prepare("SELECT * FROM audit_log").get() as Record<
        string,
        string
      >;
      assert.equal(row.actor_id, "owner-1");
      assert.equal(row.action, "team.member.add");
      assert.equal(row.grantee_id, "dev-1");
    } finally {
      db.close();
    }
  });
});
