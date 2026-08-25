import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openPlatformDb } from "../platform-db";
import { createOrgsRepository, OrgOwnsProjectsError } from "../orgs-store";
import { createTeamsRepository } from "../teams-store";
import { createProjectSharesRepository } from "../project-shares-store";

function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "hexagen-org-delete-")), "p.db");
  const db = openPlatformDb(path);
  return {
    db,
    orgs: createOrgsRepository(db),
    teams: createTeamsRepository(db),
    shares: createProjectSharesRepository(db),
  };
}

type Db = ReturnType<typeof fixture>["db"];

const count = (db: Db, sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;

/**
 * Seed one org with an owner, an extra member, a team with a member, a
 * pending invite, and grants where the ORG and its TEAM are grantees on a
 * project owned by someone else. Every row class the deletion must touch.
 */
async function seedOrg(f: ReturnType<typeof fixture>) {
  const org = await f.orgs.createOrg({
    slug: "acme",
    name: "Acme",
    createdBy: "owner-1",
  });
  await f.orgs.addMember(org.id, "owner-1", "owner");
  await f.orgs.addMember(org.id, "member-1", "member");
  const team = await f.teams.createTeam({
    orgId: org.id,
    slug: "platform",
    name: "Platform",
    createdBy: "owner-1",
  });
  await f.teams.addMember(team.id, "member-1", { actorId: "owner-1" });
  await f.orgs.invite(org.id, "someone", "member", { actorId: "owner-1" });
  // Grants on ANOTHER tenant's project, where this org / its team are the
  // grantees. Their access must die with the org.
  await f.shares.grant({
    ownerId: "other-user",
    projectId: "their-project",
    granteeType: "org",
    granteeId: org.id,
    role: "read",
    grantedBy: "other-user",
  });
  await f.shares.grant({
    ownerId: "other-user",
    projectId: "their-project",
    granteeType: "team",
    granteeId: team.id,
    role: "write",
    grantedBy: "other-user",
  });
  return { org, team };
}

describe("orgs-store.deleteOrg — tenancy hygiene", () => {
  it("refuses with a typed error while the org owns projects", async () => {
    const f = fixture();
    try {
      const { org } = await seedOrg(f);
      // The org owns a project — asserted present, so the refusal below is
      // the policy and not a missing row.
      f.db
        .prepare(
          `INSERT INTO saved_projects (owner_id, id, name, payload, created_at, updated_at, ord)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(
          org.id,
          "p-1",
          "Project",
          "{}",
          new Date().toISOString(),
          new Date().toISOString(),
        );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM saved_projects WHERE owner_id = ?",
          org.id,
        ),
        1,
      );

      await assert.rejects(
        () => f.orgs.deleteOrg(org.id, { actorId: "owner-1" }),
        (err: unknown) => {
          assert.ok(err instanceof OrgOwnsProjectsError);
          assert.equal(err.projectCount, 1);
          return true;
        },
      );
      // Nothing was touched by the refusal.
      assert.ok(await f.orgs.getOrg(org.id), "org must survive the refusal");
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
          org.id,
        ),
        2,
      );
    } finally {
      f.db.close();
    }
  });

  it("removes every row class in one pass, revokes grantee access, audits once", async () => {
    const f = fixture();
    try {
      const { org, team } = await seedOrg(f);

      // Non-vacuity: every class the deletion must touch exists BEFORE.
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
          org.id,
        ),
        2,
      );
      assert.equal(
        count(f.db, "SELECT COUNT(*) AS n FROM teams WHERE org_id = ?", org.id),
        1,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
          team.id,
        ),
        1,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ?",
          org.id,
        ),
        1,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM project_shares WHERE revoked_at IS NULL AND grantee_id IN (?, ?)",
          org.id,
          team.id,
        ),
        2,
        "both grantee grants must be LIVE before the deletion",
      );
      // The directive's reasoning, asserted rather than left as prose: with
      // zero owned projects there are no live grants where the org is OWNER.
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ? AND revoked_at IS NULL",
          org.id,
        ),
        0,
        "an org that owns zero projects can hold zero owner-side grants",
      );

      await f.orgs.deleteOrg(org.id, { actorId: "owner-1" });

      assert.equal(
        count(f.db, "SELECT COUNT(*) AS n FROM orgs WHERE id = ?", org.id),
        0,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
          org.id,
        ),
        0,
      );
      assert.equal(
        count(f.db, "SELECT COUNT(*) AS n FROM teams WHERE org_id = ?", org.id),
        0,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
          team.id,
        ),
        0,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ?",
          org.id,
        ),
        0,
      );
      // Soft-revoke: rows SURVIVE (audit trail), access does not.
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM project_shares WHERE grantee_id IN (?, ?)",
          org.id,
          team.id,
        ),
        2,
        "grant rows must survive as audit trail",
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM project_shares WHERE revoked_at IS NULL AND grantee_id IN (?, ?)",
          org.id,
          team.id,
        ),
        0,
        "no grant reaching the dead org may remain live",
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'org.delete'",
        ),
        1,
      );
    } finally {
      f.db.close();
    }
  });

  it("is one transaction: a failing final delete leaves every row intact", async () => {
    const f = fixture();
    try {
      const { org, team } = await seedOrg(f);
      // Prove the org IS deletable in the success case first — a trigger that
      // fires on an undeletable org proves nothing about atomicity.
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM saved_projects WHERE owner_id = ?",
          org.id,
        ),
        0,
      );

      // Abort on the LAST statement (the org-row delete): everything before
      // it has already run, so only a real transaction can undo it.
      f.db.exec(`
        CREATE TRIGGER abort_org_delete BEFORE DELETE ON orgs
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
      `);
      await assert.rejects(() =>
        f.orgs.deleteOrg(org.id, { actorId: "owner-1" }),
      );

      assert.equal(
        count(f.db, "SELECT COUNT(*) AS n FROM orgs WHERE id = ?", org.id),
        1,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
          org.id,
        ),
        2,
      );
      assert.equal(
        count(f.db, "SELECT COUNT(*) AS n FROM teams WHERE org_id = ?", org.id),
        1,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
          team.id,
        ),
        1,
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM project_shares WHERE revoked_at IS NULL AND grantee_id IN (?, ?)",
          org.id,
          team.id,
        ),
        2,
        "the grant revocation must roll back with everything else",
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'org.delete'",
        ),
        0,
        "no audit row for a deletion that did not happen",
      );
    } finally {
      f.db.close();
    }
  });
});

describe("orgs-store.deleteOrg — owner-side residue (review flags on #658)", () => {
  it("revokes a live grant the org OWNS even when no saved project backs it", async () => {
    // The schema does not force a share row's project to exist, so the
    // zero-owned-projects gate alone does not prove zero live owner-side
    // grants. Such a ghost row must die with the org.
    const f = fixture();
    try {
      const { org } = await seedOrg(f);
      await f.shares.grant({
        ownerId: org.id,
        projectId: "project-with-no-row",
        granteeType: "user",
        granteeId: "someone-else",
        role: "read",
        grantedBy: "owner-1",
      });
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ? AND revoked_at IS NULL",
          org.id,
        ),
        1,
        "the ghost grant must be LIVE before deletion for this test to prove anything",
      );

      await f.orgs.deleteOrg(org.id, { actorId: "owner-1" });

      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ? AND revoked_at IS NULL",
          org.id,
        ),
        0,
        "no grant owned by the deleted org may stay live",
      );
      // Soft-revoke: the row itself survives as the audit trail.
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ?",
          org.id,
        ),
        1,
      );
    } finally {
      f.db.close();
    }
  });

  it("removes the org's run telemetry, and only the org's", async () => {
    const f = fixture();
    try {
      const { org } = await seedOrg(f);
      const insertRun = f.db.prepare(
        `INSERT INTO run_events (id, owner_id, run_id, stage, label, duration_ms,
           retry_count, input_tokens, output_tokens, served_from_cache, used_llm,
           summary, created_at)
         VALUES (?, ?, ?, 0, 'stage-0', 1, 0, 0, 0, 0, 0, 's', ?)`,
      );
      insertRun.run("evt-1", org.id, "run-1", Date.now());
      insertRun.run("evt-2", "unrelated-user", "run-2", Date.now());

      await f.orgs.deleteOrg(org.id, { actorId: "owner-1" });

      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM run_events WHERE owner_id = ?",
          org.id,
        ),
        0,
        "the deleted tenant's runs are unreachable orphans and must go",
      );
      assert.equal(
        count(
          f.db,
          "SELECT COUNT(*) AS n FROM run_events WHERE owner_id = ?",
          "unrelated-user",
        ),
        1,
        "another tenant's runs must be untouched",
      );
    } finally {
      f.db.close();
    }
  });
});
