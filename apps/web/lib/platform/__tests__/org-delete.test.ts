// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createOrgsRepository, OrgOwnsProjectsError } from "../orgs-store";
import {
  BACKENDS,
  openBackend,
  failOnSql,
} from "../../../test-support/platform-backends";
import type { Backend } from "../../../test-support/platform-backends";
import type { PlatformDb, SqlValue } from "../db";

function defined<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error("expected " + what);
  return v;
}

const count = async (db: PlatformDb, sql: string, ...args: SqlValue[]) =>
  defined(await db.get<{ n: number }>(sql, args), "count").n;

/**
 * Seed one org with an owner, an extra member, a team with a member, a
 * pending invite, and grants where the ORG and its TEAM are grantees on a
 * project owned by someone else. Every row class the deletion must touch.
 */
async function seedOrg(backend: Backend) {
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
  const team = await teams.createTeam({
    orgId: org.id,
    slug: "platform",
    name: "Platform",
    createdBy: "owner-1",
  });
  await teams.addMember(team.id, "member-1", { actorId: "owner-1" });
  await orgs.invite(org.id, "someone", "member", { actorId: "owner-1" });
  // Grants on ANOTHER tenant's project, where this org / its team are the
  // grantees. Their access must die with the org.
  await shares.grant({
    ownerId: "other-user",
    projectId: "their-project",
    granteeType: "org",
    granteeId: org.id,
    role: "read",
    grantedBy: "other-user",
  });
  await shares.grant({
    ownerId: "other-user",
    projectId: "their-project",
    granteeType: "team",
    granteeId: team.id,
    role: "write",
    grantedBy: "other-user",
  });
  return { org, team };
}

describe.each(BACKENDS)(
  "orgs-store.deleteOrg — tenancy hygiene (%s",
  (kind) => {
    it("refuses with a typed error while the org owns projects", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const { org } = await seedOrg(backend);
        // The org owns a project — asserted present, so the refusal below is
        // the policy and not a missing row.
        await backend.db.run(
          `INSERT INTO saved_projects (owner_id, id, name, payload, created_at, updated_at, ord)
         VALUES (?, ?, ?, ?, hx_ts(?), hx_ts(?), 0)`,
          [org.id, "p-1", "Project", "{}", Date.now(), Date.now()],
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM saved_projects WHERE owner_id = ?",
            org.id,
          ),
          1,
        );

        await assert.rejects(
          () => orgs.deleteOrg(org.id, { actorId: "owner-1" }),
          (err: unknown) => {
            assert.ok(err instanceof OrgOwnsProjectsError);
            assert.equal(err.projectCount, 1);
            return true;
          },
        );
        // Nothing was touched by the refusal.
        assert.ok(await orgs.getOrg(org.id), "org must survive the refusal");
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
            org.id,
          ),
          2,
        );
      } finally {
        await backend.close();
      }
    });

    it("removes every row class in one pass, revokes grantee access, audits once", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const { org, team } = await seedOrg(backend);

        // Non-vacuity: every class the deletion must touch exists BEFORE.
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
            org.id,
          ),
          2,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM teams WHERE org_id = ?",
            org.id,
          ),
          1,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
            team.id,
          ),
          1,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ?",
            org.id,
          ),
          1,
        );
        assert.equal(
          await count(
            backend.db,
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
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ? AND revoked_at IS NULL",
            org.id,
          ),
          0,
          "an org that owns zero projects can hold zero owner-side grants",
        );

        await orgs.deleteOrg(org.id, { actorId: "owner-1" });

        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM orgs WHERE id = ?",
            org.id,
          ),
          0,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
            org.id,
          ),
          0,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM teams WHERE org_id = ?",
            org.id,
          ),
          0,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
            team.id,
          ),
          0,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ?",
            org.id,
          ),
          0,
        );
        // Soft-revoke: rows SURVIVE (audit trail), access does not.
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM project_shares WHERE grantee_id IN (?, ?)",
            org.id,
            team.id,
          ),
          2,
          "grant rows must survive as audit trail",
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM project_shares WHERE revoked_at IS NULL AND grantee_id IN (?, ?)",
            org.id,
            team.id,
          ),
          0,
          "no grant reaching the dead org may remain live",
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'org.delete'",
          ),
          1,
        );
      } finally {
        await backend.close();
      }
    });

    it("is one transaction: a failing final delete leaves every row intact", async () => {
      const backend = await openBackend(kind);
      try {
        const { org, team } = await seedOrg(backend);
        // Prove the org IS deletable in the success case first — a trigger that
        // fires on an undeletable org proves nothing about atomicity.
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM saved_projects WHERE owner_id = ?",
            org.id,
          ),
          0,
        );

        // Abort on the LAST statement (the org-row delete): everything before
        // it has already run, so only a real transaction can undo it.
        const decorated = failOnSql(
          backend.db,
          (sql) => sql.trimStart().startsWith("DELETE FROM orgs "),
          new Error("boom"),
        );
        const brokenOrgs = createOrgsRepository(decorated);
        await assert.rejects(() =>
          brokenOrgs.deleteOrg(org.id, { actorId: "owner-1" }),
        );

        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM orgs WHERE id = ?",
            org.id,
          ),
          1,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?",
            org.id,
          ),
          2,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM teams WHERE org_id = ?",
            org.id,
          ),
          1,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?",
            team.id,
          ),
          1,
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM project_shares WHERE revoked_at IS NULL AND grantee_id IN (?, ?)",
            org.id,
            team.id,
          ),
          2,
          "the grant revocation must roll back with everything else",
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'org.delete'",
          ),
          0,
          "no audit row for a deletion that did not happen",
        );
      } finally {
        await backend.close();
      }
    });
  },
);

describe.each(BACKENDS)(
  "orgs-store.deleteOrg — owner-side residue (%s",
  (kind) => {
    it("revokes a live grant the org OWNS even when no saved project backs it", async () => {
      // The schema does not force a share row's project to exist, so the
      // zero-owned-projects gate alone does not prove zero live owner-side
      // grants. Such a ghost row must die with the org.
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const shares = backend.store.shares;
        const { org } = await seedOrg(backend);
        await shares.grant({
          ownerId: org.id,
          projectId: "project-with-no-row",
          granteeType: "user",
          granteeId: "someone-else",
          role: "read",
          grantedBy: "owner-1",
        });
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ? AND revoked_at IS NULL",
            org.id,
          ),
          1,
          "the ghost grant must be LIVE before deletion for this test to prove anything",
        );

        await orgs.deleteOrg(org.id, { actorId: "owner-1" });

        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ? AND revoked_at IS NULL",
            org.id,
          ),
          0,
          "no grant owned by the deleted org may stay live",
        );
        // Soft-revoke: the row itself survives as the audit trail.
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM project_shares WHERE owner_id = ?",
            org.id,
          ),
          1,
        );
      } finally {
        await backend.close();
      }
    });

    it("removes the org's run telemetry, and only the org's", async () => {
      const backend = await openBackend(kind);
      try {
        const orgs = backend.store.orgs;
        const { org } = await seedOrg(backend);
        const insertRun = `INSERT INTO run_events (id, owner_id, run_id, stage, label, duration_ms,
   retry_count, input_tokens, output_tokens, served_from_cache, used_llm,
   summary, created_at)
VALUES (?, ?, ?, 0, 'stage-0', 1, 0, 0, 0, ?, ?, 's', hx_ts(?))`;
        await backend.db.run(insertRun, [
          "evt-1",
          org.id,
          "run-1",
          0,
          0,
          Date.now(),
        ]);
        await backend.db.run(insertRun, [
          "evt-2",
          "unrelated-user",
          "run-2",
          0,
          0,
          Date.now(),
        ]);

        await orgs.deleteOrg(org.id, { actorId: "owner-1" });

        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM run_events WHERE owner_id = ?",
            org.id,
          ),
          0,
          "the deleted tenant's runs are unreachable orphans and must go",
        );
        assert.equal(
          await count(
            backend.db,
            "SELECT COUNT(*) AS n FROM run_events WHERE owner_id = ?",
            "unrelated-user",
          ),
          1,
          "another tenant's runs must be untouched",
        );
      } finally {
        await backend.close();
      }
    });
  },
);
