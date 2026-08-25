import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openPlatformDb, ORG_INVITE_TTL_DAYS } from "../platform-db";
import { createOrgsRepository, LastOwnerError } from "../orgs-store";
import { createTeamsRepository } from "../teams-store";
import { createAuditLogRepository } from "../audit-log-store";

function fixture() {
  const path = join(
    mkdtempSync(join(tmpdir(), "hexagen-org-members-")),
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

type Fx = ReturnType<typeof fixture>;

const seedOrg = (fx: Fx, id = "org-acme") =>
  fx.orgs.createOrg({
    id,
    slug: id,
    name: "Acme",
    createdBy: "founder",
  });

const countTeamRows = (db: Fx["db"], userId: string) =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?")
      .get(userId) as { n: number }
  ).n;

/**
 * Backdates an invite's expiry by writing the column directly.
 *
 * The store has no "expire this now" method and should not: the only way an
 * invite expires in production is the clock passing `expires_at`, so the test
 * moves the deadline rather than the clock. Writing the column is honest about
 * what it is simulating.
 */
const backdate = (db: Fx["db"], orgId: string, login: string) =>
  db
    .prepare(
      "UPDATE org_invites SET expires_at = ? WHERE org_id = ? AND github_login = ?",
    )
    .run(new Date(Date.now() - 1000).toISOString(), orgId, login);

describe("H1.2 — org membership invariants", () => {
  it("an org can never lose its last owner: removal and demotion both refuse", async () => {
    // The unrecoverable one. An org with zero owners can never again pass
    // `requireOwnerRole`, so no route can add a member, invite anyone, or
    // delete it — and there is no way back in through the API.
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.addMember("org-acme", "founder", "owner");

      await assert.rejects(
        () => fx.orgs.removeMember("org-acme", "founder"),
        LastOwnerError,
      );
      await assert.rejects(
        () => fx.orgs.addMember("org-acme", "founder", "member"),
        LastOwnerError,
      );

      // Non-vacuity: the refusals left the membership exactly as it was, so
      // they are refusals rather than a partially applied mutation.
      assert.equal(await fx.orgs.memberRole("org-acme", "founder"), "owner");
    } finally {
      fx.db.close();
    }
  });

  it("with a SECOND owner present, the same two calls succeed", async () => {
    // Without this, the test above passes just as well against a store that
    // refuses every removal and every demotion.
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.addMember("org-acme", "founder", "owner");
      await fx.orgs.addMember("org-acme", "second", "owner");
      await fx.orgs.addMember("org-acme", "third", "owner");

      // Three owners, so the demotion leaves two and the removal leaves one:
      // each call is the same call the previous test rejected, differing only
      // in whether another owner remains.
      await fx.orgs.addMember("org-acme", "founder", "member");
      assert.equal(await fx.orgs.memberRole("org-acme", "founder"), "member");

      await fx.orgs.removeMember("org-acme", "second");
      assert.equal(await fx.orgs.memberRole("org-acme", "second"), null);
      assert.equal(await fx.orgs.memberRole("org-acme", "third"), "owner");
    } finally {
      fx.db.close();
    }
  });

  it("removing a member clears their team rows in the SAME transaction", async () => {
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.addMember("org-acme", "founder", "owner");
      await fx.orgs.addMember("org-acme", "dev-1", "member");
      const team = await fx.teams.createTeam({
        orgId: "org-acme",
        slug: "platform",
        name: "Platform",
        createdBy: "founder",
      });
      await fx.teams.addMember(team.id, "dev-1");
      assert.equal(countTeamRows(fx.db, "dev-1"), 1);

      await fx.orgs.removeMember("org-acme", "dev-1");
      assert.equal(await fx.orgs.memberRole("org-acme", "dev-1"), null);
      assert.equal(
        countTeamRows(fx.db, "dev-1"),
        0,
        "a team membership outliving its org membership is a grant nobody can see or revoke",
      );
    } finally {
      fx.db.close();
    }
  });

  it("a re-add at the SAME role writes no audit row; a role CHANGE writes role_change", async () => {
    // `ON CONFLICT DO UPDATE SET role = excluded.role` reports changes = 1
    // even when the role is identical, so a `.changes > 0` gate would record a
    // role change that did not happen.
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.addMember("org-acme", "founder", "owner", {
        actorId: "founder",
      });
      await fx.orgs.addMember("org-acme", "dev-1", "member", {
        actorId: "founder",
      });
      assert.equal(await fx.audit.countFor("org.member.add", "org-acme"), 2);

      await fx.orgs.addMember("org-acme", "dev-1", "member", {
        actorId: "founder",
      });
      assert.equal(
        await fx.audit.countFor("org.member.add", "org-acme"),
        2,
        "a duplicate add is not a second add",
      );
      assert.equal(
        await fx.audit.countFor("org.member.role_change", "org-acme"),
        0,
        "a re-add at the same role is not a role change",
      );

      await fx.orgs.addMember("org-acme", "dev-1", "owner", {
        actorId: "founder",
      });
      assert.equal(
        await fx.audit.countFor("org.member.role_change", "org-acme"),
        1,
      );
      assert.equal(
        await fx.audit.countFor("org.member.add", "org-acme"),
        2,
        "a promotion is not an add",
      );
    } finally {
      fx.db.close();
    }
  });

  it("removing someone who is not a member writes no audit row", async () => {
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.addMember("org-acme", "founder", "owner");
      await fx.orgs.removeMember("org-acme", "stranger", {
        actorId: "founder",
      });
      assert.equal(
        await fx.audit.countFor("org.member.remove", "org-acme"),
        0,
        "an audit row for a removal that hit nothing is indistinguishable from a real one",
      );
    } finally {
      fx.db.close();
    }
  });
});

describe("H1.2 — invitations", () => {
  it("a pending invite becomes a membership at sign-in, audited once", async () => {
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.addMember("org-acme", "founder", "owner");
      await fx.orgs.invite("org-acme", "Ada", "member", {
        actorId: "founder",
      });
      assert.equal(await fx.audit.countFor("org.invite", "org-acme"), 1);
      assert.equal(await fx.orgs.memberRole("org-acme", "ada-user"), null);

      // Case differs from the invite on purpose: GitHub logins are
      // case-insensitive and `@Ada` must meet `ada`.
      const joined = await fx.orgs.acceptInvitesForLogin("ada-user", "ada");
      assert.deepEqual(joined, ["org-acme"]);
      assert.equal(await fx.orgs.memberRole("org-acme", "ada-user"), "member");
      assert.equal(await fx.audit.countFor("org.invite.accept", "org-acme"), 1);

      // A second sign-in must not re-grant or re-log: the invite is spent.
      const again = await fx.orgs.acceptInvitesForLogin("ada-user", "ada");
      assert.deepEqual(again, []);
      assert.equal(
        await fx.audit.countFor("org.invite.accept", "org-acme"),
        1,
        "acceptance is recorded exactly once",
      );
      assert.deepEqual(await fx.orgs.listPendingInvites("org-acme"), []);
    } finally {
      fx.db.close();
    }
  });

  it("re-sending an identical pending invite writes no second audit row", async () => {
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.invite("org-acme", "ada", "member", { actorId: "founder" });
      await fx.orgs.invite("org-acme", "ada", "member", { actorId: "founder" });
      assert.equal(
        await fx.audit.countFor("org.invite", "org-acme"),
        1,
        "an outstanding invitation re-sent unchanged is not a new invitation",
      );

      // A changed ROLE is a real event and must be recorded.
      await fx.orgs.invite("org-acme", "ada", "owner", { actorId: "founder" });
      assert.equal(await fx.audit.countFor("org.invite", "org-acme"), 2);
      const [pending] = await fx.orgs.listPendingInvites("org-acme");
      assert.equal(pending.role, "owner");
    } finally {
      fx.db.close();
    }
  });

  it("acceptance is ATOMIC: a failed membership write leaves the invite pending", async () => {
    // The stamp and the membership are one transaction. Split into two
    // commits, a failure between them marks the invite accepted with no
    // membership behind it — access silently lost, and never retried, because
    // the pending-invite query no longer matches the row.
    //
    // The trigger stands in for that failure: it is the only way to make the
    // second statement fail after the first has run.
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.invite("org-acme", "ada", "member", { actorId: "founder" });
      fx.db.exec(`
        CREATE TRIGGER block_org_members BEFORE INSERT ON org_members
        BEGIN SELECT RAISE(ABORT, 'membership write failed'); END;
      `);

      await assert.rejects(() =>
        fx.orgs.acceptInvitesForLogin("ada-user", "ada"),
      );

      fx.db.exec("DROP TRIGGER block_org_members");
      const pending = await fx.orgs.listPendingInvites("org-acme");
      assert.equal(
        pending.length,
        1,
        "the acceptance stamp must roll back with the failed membership write",
      );
      assert.equal(pending[0].acceptedAt, null);
      assert.equal(
        await fx.audit.countFor("org.invite.accept", "org-acme"),
        0,
        "no acceptance happened, so no acceptance may be recorded",
      );

      // And the invite is still redeemable, which is the whole point.
      assert.deepEqual(await fx.orgs.acceptInvitesForLogin("ada-user", "ada"), [
        "org-acme",
      ]);
    } finally {
      fx.db.close();
    }
  });

  it("acceptance never DEMOTES an existing membership", async () => {
    // An invite issued as `member` to someone who has since become an owner
    // would otherwise strip their ownership the moment they signed in.
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.addMember("org-acme", "ada-user", "owner");
      await fx.orgs.invite("org-acme", "ada", "member", { actorId: "founder" });

      await fx.orgs.acceptInvitesForLogin("ada-user", "ada");
      assert.equal(await fx.orgs.memberRole("org-acme", "ada-user"), "owner");
    } finally {
      fx.db.close();
    }
  });
});

describe("H1.2 — invite expiry", () => {
  it("an EXPIRED invite does not become a membership, while a live one does", async () => {
    // The hijack this closes: a GitHub login can be renamed and the freed
    // handle re-registered by a stranger. An invite that never expires is a
    // standing offer of write access to whoever holds `@login` at sign-in.
    //
    // The live invite is asserted FIRST and in the same run, so the refusal
    // below is the expiry rule rather than acceptance being broken outright.
    const fx = fixture();
    try {
      await seedOrg(fx, "org-live");
      await seedOrg(fx, "org-stale");
      await fx.orgs.invite("org-live", "ada", "member", { actorId: "founder" });
      await fx.orgs.invite("org-stale", "ada", "member", {
        actorId: "founder",
      });
      backdate(fx.db, "org-stale", "ada");

      const joined = await fx.orgs.acceptInvitesForLogin("ada-user", "ada");

      assert.deepEqual(
        joined,
        ["org-live"],
        "the unexpired invite must still be redeemed — otherwise this test proves nothing about expiry",
      );
      assert.equal(await fx.orgs.memberRole("org-live", "ada-user"), "member");
      assert.equal(
        await fx.orgs.memberRole("org-stale", "ada-user"),
        null,
        "an expired invite must not grant membership",
      );
      assert.equal(
        await fx.audit.countFor("org.invite.accept", "org-stale"),
        0,
        "skipping an expired invite is not an acceptance",
      );
    } finally {
      fx.db.close();
    }
  });

  it("an expired invite is left in place as evidence, not deleted", async () => {
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.invite("org-acme", "ada", "member", { actorId: "founder" });
      backdate(fx.db, "org-acme", "ada");
      await fx.orgs.acceptInvitesForLogin("ada-user", "ada");

      const row = fx.db
        .prepare(
          "SELECT accepted_at FROM org_invites WHERE org_id = ? AND github_login = ?",
        )
        .get("org-acme", "ada") as { accepted_at: string | null } | undefined;
      assert.ok(row, "the row is the record that someone was invited");
      assert.equal(
        row.accepted_at,
        null,
        "an expired invite is neither accepted nor marked accepted",
      );

      // And it is not offered as pending, because it can no longer be redeemed.
      assert.deepEqual(await fx.orgs.listPendingInvites("org-acme"), []);
    } finally {
      fx.db.close();
    }
  });

  it("re-inviting revives an expired invite with a fresh deadline", async () => {
    // The only route back for a lapsed invitation, and a genuine event, so it
    // is audited even though the (org, login, role) triple is unchanged.
    const fx = fixture();
    try {
      await seedOrg(fx);
      await fx.orgs.invite("org-acme", "ada", "member", { actorId: "founder" });
      backdate(fx.db, "org-acme", "ada");

      const revived = await fx.orgs.invite("org-acme", "ada", "member", {
        actorId: "founder",
      });
      assert.ok(revived.expiresAt > new Date().toISOString());
      assert.equal(await fx.audit.countFor("org.invite", "org-acme"), 2);

      const joined = await fx.orgs.acceptInvitesForLogin("ada-user", "ada");
      assert.deepEqual(joined, ["org-acme"]);
    } finally {
      fx.db.close();
    }
  });

  it("a new invite expires ORG_INVITE_TTL_DAYS out, in the format comparisons assume", async () => {
    const fx = fixture();
    try {
      await seedOrg(fx);
      const invite = await fx.orgs.invite("org-acme", "ada", "member", {
        actorId: "founder",
      });
      const days =
        (Date.parse(invite.expiresAt) - Date.parse(invite.createdAt)) /
        86_400_000;
      assert.ok(
        Math.abs(days - ORG_INVITE_TTL_DAYS) < 0.01,
        `expected ~${ORG_INVITE_TTL_DAYS} days, got ${days}`,
      );
      // Expiry is a lexicographic string comparison in SQL, which is only
      // chronological if both sides are `toISOString()` shaped.
      assert.match(
        invite.expiresAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    } finally {
      fx.db.close();
    }
  });

  it("legacy invites created before the column get a real deadline, not ''", async () => {
    // The backfill: '' would sort before any ISO timestamp and read as
    // "already expired", silently voiding every live invitation on the volume.
    const fx = fixture();
    try {
      await seedOrg(fx);
      // Simulate the pre-migration shape by rebuilding the table without the
      // column, then reopening the database so the migration runs.
      fx.db.exec(`
        DROP TABLE org_invites;
        CREATE TABLE org_invites (
          org_id TEXT NOT NULL,
          github_login TEXT NOT NULL COLLATE NOCASE,
          role TEXT NOT NULL,
          invited_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          accepted_at TEXT,
          PRIMARY KEY (org_id, github_login)
        );
      `);
      fx.db
        .prepare(
          "INSERT INTO org_invites (org_id, github_login, role, invited_by, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, NULL)",
        )
        .run("org-acme", "ada", "member", "founder", new Date().toISOString());
      const path = fx.db.name;
      fx.db.close();

      const db = openPlatformDb(path);
      try {
        const orgs = createOrgsRepository(db);
        const [pending] = await orgs.listPendingInvites("org-acme");
        assert.ok(pending, "the migrated invite must still be redeemable");
        assert.match(
          pending.expiresAt,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
        assert.deepEqual(await orgs.acceptInvitesForLogin("ada-user", "ada"), [
          "org-acme",
        ]);
      } finally {
        db.close();
      }
    } finally {
      // fx.db is already closed above; closing twice is a no-op error, so
      // guard rather than double-close.
      if (fx.db.open) fx.db.close();
    }
  });
});
