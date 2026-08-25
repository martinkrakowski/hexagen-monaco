import type Database from "better-sqlite3";
import { prepareAuditAppend, type AuditEntry } from "./audit-log-store";
import { ORG_INVITE_TTL_MS } from "./platform-db";

/**
 * Organisations and their membership (H1.1 / H1.2).
 *
 * An org is just another owner: its UUID is written into the same `owner_id`
 * column every project statement already scopes by, so nothing in
 * `saved-projects-store` or `run-history-store` changes. What changes is who
 * may present that `owner_id` — resolved here, per request, by
 * `requireTenant`.
 *
 * ASYNC BY DECISION (D-A9), even though better-sqlite3 is synchronous. The
 * Postgres move's real cost is the sync→async contract change across every
 * caller; a store added today in sync form would add to that bill. Callers
 * await; the adapter underneath can change without touching them.
 */

/** H1.3 / D-A2: two roles, deliberately. */
export type OrgRole = "owner" | "member";

/**
 * The mutation would leave the org with no `owner`.
 *
 * This is the one org invariant that is UNRECOVERABLE through the API: an org
 * with zero owners can never again pass `requireOwnerRole`, so nobody can add
 * a member, invite anyone, or delete it — and no route exists to appoint an
 * owner from outside. Both the removal path and the demotion path can reach
 * it, which is why the check lives in the STORE next to the writes rather than
 * in either route: a third caller (an invite acceptance, a future bulk import)
 * must not be able to bypass it by not knowing about it. Routes map it to 409.
 */
export class LastOwnerError extends Error {
  readonly code = "last_owner";
  constructor(
    readonly orgId: string,
    readonly userId: string,
  ) {
    super(
      `user ${userId} is the last owner of org ${orgId} and cannot be removed or demoted`,
    );
    this.name = "LastOwnerError";
  }
}

/**
 * Who performed a mutation, so the store can write its audit row inside the
 * SAME transaction (D-A6). Mirrors `TeamAuditContext`: the store owns the
 * action vocabulary and the subject ids, the caller only says who.
 */
export interface OrgAuditContext {
  actorId: string;
}

/** A pending or accepted invitation, keyed by GitHub login (H1.2). */
export interface OrgInvite {
  orgId: string;
  githubLogin: string;
  role: OrgRole;
  invitedBy: string;
  createdAt: string;
  /** ISO-8601 UTC; past this instant the invite is inert (ORG_INVITE_TTL_MS). */
  expiresAt: string;
  acceptedAt: string | null;
}

export interface Org {
  id: string;
  slug: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface OrgMember {
  userId: string;
  role: OrgRole;
  createdAt: string;
}

export interface OrgsRepository {
  createOrg(input: {
    id?: string;
    slug: string;
    name: string;
    createdBy: string;
  }): Promise<Org>;
  getOrg(orgId: string): Promise<Org | null>;
  getOrgBySlug(slug: string): Promise<Org | null>;
  /**
   * Adds the member, or changes an existing member's role.
   * @throws LastOwnerError when it would demote the org's only owner.
   */
  addMember(
    orgId: string,
    userId: string,
    role: OrgRole,
    audit?: OrgAuditContext,
  ): Promise<void>;
  /**
   * Also clears the user's team memberships in this org, atomically (P-A2).
   * @throws LastOwnerError when it would remove the org's only owner.
   */
  removeMember(
    orgId: string,
    userId: string,
    audit?: OrgAuditContext,
  ): Promise<void>;
  /** The membership decision `requireTenant` asks on every request. */
  memberRole(orgId: string, userId: string): Promise<OrgRole | null>;
  listOrgIdsForUser(userId: string): Promise<string[]>;
  listMembers(orgId: string): Promise<OrgMember[]>;
  /** Records a pending invitation for a login with no account yet (H1.2). */
  invite(
    orgId: string,
    githubLogin: string,
    role: OrgRole,
    audit: OrgAuditContext,
  ): Promise<OrgInvite>;
  listPendingInvites(orgId: string): Promise<OrgInvite[]>;
  /**
   * Turns every pending invite for `login` into a membership and marks it
   * accepted, in ONE transaction. Called from the sign-in seam, where the
   * handle first becomes known. Returns the orgs joined.
   */
  acceptInvitesForLogin(userId: string, login: string): Promise<string[]>;
}

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  created_by: string;
  created_at: string;
}

interface InviteRow {
  org_id: string;
  github_login: string;
  role: OrgRole;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

function toOrg(row: OrgRow): Org {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toInvite(row: InviteRow): OrgInvite {
  return {
    orgId: row.org_id,
    githubLogin: row.github_login,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

/**
 * Matches `auth-store`'s canonicalisation so an invite written as "Ada" and a
 * sign-in arriving as "ada" meet. `org_invites.github_login` is COLLATE
 * NOCASE, which makes the LOOKUP case-insensitive, but the stored text is
 * whatever was typed — canonicalising on write keeps the audit trail and the
 * pending-invite list from showing three spellings of one person.
 */
function canonicalizeGithubLogin(login: string): string {
  return login.trim().toLowerCase();
}

function assertRole(role: OrgRole): void {
  if (role !== "owner" && role !== "member") {
    throw new Error(`invalid org role: ${role}`);
  }
}

export function createOrgsRepository(db: Database.Database): OrgsRepository {
  const insertOrg = db.prepare(`
    INSERT INTO orgs (id, slug, name, created_by, created_at)
    VALUES (@id, @slug, @name, @created_by, @created_at)
  `);
  const userIdTaken = db.prepare("SELECT 1 AS ok FROM users WHERE id = ?");
  const selectOrg = db.prepare("SELECT * FROM orgs WHERE id = ?");
  const selectOrgBySlug = db.prepare("SELECT * FROM orgs WHERE slug = ?");
  const upsertMember = db.prepare(`
    INSERT INTO org_members (org_id, user_id, role, created_at)
    VALUES (@org_id, @user_id, @role, @created_at)
    ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role
  `);
  // Promote-never-demote at acceptance: an owner-level invite to someone who
  // joined as a member in the meantime lands the promotion; a member-level
  // invite to someone who became an owner changes nothing. Both directions
  // are asserted in org-members.guard.test.
  const insertMemberIfAbsent = db.prepare(`
    INSERT INTO org_members (org_id, user_id, role, created_at)
    VALUES (@org_id, @user_id, @role, @created_at)
    ON CONFLICT(org_id, user_id) DO UPDATE SET role = 'owner'
      WHERE excluded.role = 'owner' AND org_members.role = 'member' 
  `);
  const deleteMember = db.prepare(
    "DELETE FROM org_members WHERE org_id = ? AND user_id = ?",
  );
  const selectMemberRow = db.prepare(
    "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?",
  );
  const countOwners = db.prepare(
    "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'owner'",
  );
  const selectMembers = db.prepare(
    "SELECT user_id, role, created_at FROM org_members WHERE org_id = ? ORDER BY created_at, user_id",
  );
  // P-A2: leaving an org leaves every team in it. A team membership that
  // outlived its org membership would be a live grant nobody can see from the
  // org page or revoke from it.
  const deleteTeamMemberships = db.prepare(`
    DELETE FROM team_members
    WHERE user_id = ?
      AND team_id IN (SELECT id FROM teams WHERE org_id = ?)
  `);
  // JOIN orgs so a membership row whose org_id is not an org (the FK
  // constraint, or a connection that forgot PRAGMA foreign_keys) cannot
  // authorize requireTenant against a personal owner id.
  const selectRole = db.prepare(`
    SELECT m.role FROM org_members m
     INNER JOIN orgs o ON o.id = m.org_id
     WHERE m.org_id = ? AND m.user_id = ?
  `);
  const selectOrgIds = db.prepare(`
    SELECT m.org_id FROM org_members m
     INNER JOIN orgs o ON o.id = m.org_id
     WHERE m.user_id = ?
     ORDER BY m.org_id
  `);

  const selectInvite = db.prepare(
    "SELECT * FROM org_invites WHERE org_id = ? AND github_login = ?",
  );
  // Only a PENDING invite is re-writable. Once accepted the row is history:
  // overwriting it would let a re-invite silently reset `accepted_at` and
  // re-grant on the next sign-in.
  const upsertInvite = db.prepare(`
    INSERT INTO org_invites (org_id, github_login, role, invited_by, created_at, expires_at, accepted_at)
    VALUES (@org_id, @github_login, @role, @invited_by, @created_at, @expires_at, NULL)
    ON CONFLICT(org_id, github_login) DO UPDATE
      SET role = excluded.role,
          invited_by = excluded.invited_by,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      WHERE org_invites.accepted_at IS NULL
  `);
  // THE expiry gate for the acceptance path -- deliberately the only one, so
  // that removing it has a single visible consequence rather than being
  // masked by a duplicate check further down. An invite past `expires_at` is
  // not returned here, so it is never stamped, never becomes a membership, and
  // never writes an acceptance row. The row itself stays: it is the evidence
  // that someone was invited and did not arrive in time, and deleting it would
  // erase that.
  //
  // String comparison is correct because both sides are ISO-8601 UTC produced
  // by `toISOString()` -- fixed width, zero-padded, same offset -- so
  // lexicographic order is chronological order.
  const selectPendingForLogin = db.prepare(
    "SELECT * FROM org_invites WHERE github_login = @login AND accepted_at IS NULL AND expires_at > @now ORDER BY org_id",
  );
  const selectPendingForOrg = db.prepare(
    "SELECT * FROM org_invites WHERE org_id = @org_id AND accepted_at IS NULL AND expires_at > @now ORDER BY github_login",
  );
  const markAccepted = db.prepare(`
    UPDATE org_invites SET accepted_at = @accepted_at
     WHERE org_id = @org_id AND github_login = @github_login
       AND accepted_at IS NULL
  `);

  // The audit row is written INSIDE each mutation's transaction, not after it
  // by a separate awaited repository call. Two independent commits mean the
  // mutation can land while the audit write throws, and an unaudited
  // membership change is exactly the event the log exists to make impossible
  // to miss.
  const appendAudit = prepareAuditAppend(db);
  const audited = (
    audit: OrgAuditContext | undefined,
    entry: Omit<AuditEntry, "actorId">,
  ) => {
    if (audit) appendAudit({ ...entry, actorId: audit.actorId });
  };

  /** @throws LastOwnerError */
  const guardLastOwner = (orgId: string, userId: string, was: OrgRole) => {
    if (was !== "owner") return;
    const { n } = countOwners.get(orgId) as { n: number };
    if (n <= 1) throw new LastOwnerError(orgId, userId);
  };

  const addMemberTx = db.transaction(
    (orgId: string, userId: string, role: OrgRole, audit?: OrgAuditContext) => {
      const existing = selectMemberRow.get(orgId, userId) as
        | { role: OrgRole }
        | undefined;

      // A re-add at the SAME role changes nothing. `ON CONFLICT DO UPDATE SET
      // role = excluded.role` still reports changes = 1 for it, so the
      // `.changes > 0` gate teams-store relies on is NOT sufficient here — it
      // would write a "role changed" row for a role that did not change.
      // Comparing before the write is what makes the audit trail honest.
      if (existing?.role === role) return;

      if (existing) guardLastOwner(orgId, userId, existing.role);

      upsertMember.run({
        org_id: orgId,
        user_id: userId,
        role,
        created_at: new Date().toISOString(),
      });
      audited(audit, {
        // A role change is not an add: conflating them would make the trail
        // unable to answer "when did this person become an owner".
        action: existing ? "org.member.role_change" : "org.member.add",
        subjectOwnerId: orgId,
        subjectId: orgId,
        granteeType: "user",
        granteeId: userId,
      });
    },
  );

  // ONE transaction, so a failure in either statement rolls back both: a user
  // dropped from the org but left in its teams is the orphan this prevents,
  // and the reverse (teams cleared, org row surviving) is just as wrong.
  const removeMemberTx = db.transaction(
    (orgId: string, userId: string, audit?: OrgAuditContext) => {
      const existing = selectMemberRow.get(orgId, userId) as
        | { role: OrgRole }
        | undefined;
      if (existing) guardLastOwner(orgId, userId, existing.role);

      deleteTeamMemberships.run(userId, orgId);
      const removed = deleteMember.run(orgId, userId);
      // Gate on affected rows: an audit row for a removal that hit nothing
      // records an event that did not happen, and a reader cannot tell it from
      // a real removal.
      if (removed.changes > 0)
        audited(audit, {
          action: "org.member.remove",
          subjectOwnerId: orgId,
          subjectId: orgId,
          granteeType: "user",
          granteeId: userId,
        });
    },
  );

  const inviteTx = db.transaction(
    (row: InviteRow, audit: OrgAuditContext): InviteRow => {
      const existing = selectInvite.get(row.org_id, row.github_login) as
        | InviteRow
        | undefined;

      // Already accepted — the person is a member; nothing to re-issue, and no
      // event happened.
      if (existing?.accepted_at) return existing;
      // Same pending invite, still live, re-sent: the row is unchanged, so an
      // audit entry would claim an invitation that was already outstanding is
      // new. An EXPIRED invite is a different matter — re-inviting is the only
      // way to revive it, so it falls through, is rewritten with a fresh
      // deadline, and is audited as the real re-invitation it is.
      if (
        existing &&
        existing.role === row.role &&
        existing.expires_at > row.created_at
      ) {
        return existing;
      }

      upsertInvite.run(row);
      audited(audit, {
        action: "org.invite",
        subjectOwnerId: row.org_id,
        subjectId: row.org_id,
        // The invitee has no user id yet — that is the whole reason this row
        // exists — so the grantee is the handle itself.
        granteeType: "github_login",
        granteeId: row.github_login,
      });
      return row;
    },
  );

  // Membership + acceptance stamp in ONE transaction. Split across two
  // commits, a crash between them leaves either an invite marked accepted with
  // no membership (silently lost access, and never retried because the
  // pending-invite query no longer matches it) or a membership whose invite
  // stays pending and re-grants on every future sign-in.
  const acceptInvitesTx = db.transaction(
    (userId: string, login: string): string[] => {
      const now = new Date().toISOString();
      const pending = selectPendingForLogin.all({
        login,
        now,
      }) as InviteRow[];
      const joined: string[] = [];
      for (const invite of pending) {
        // Stamp first and gate on it: if two sign-ins race, only the one whose
        // UPDATE matched `accepted_at IS NULL` writes the membership and the
        // audit row, so acceptance is recorded exactly once.
        const stamped = markAccepted.run({
          accepted_at: now,
          org_id: invite.org_id,
          github_login: invite.github_login,
        });
        if (stamped.changes === 0) continue;
        insertMemberIfAbsent.run({
          org_id: invite.org_id,
          user_id: userId,
          role: invite.role,
          created_at: now,
        });
        appendAudit({
          // The acceptor is the actor: they are the one performing this
          // mutation. The inviter is already on the `org.invite` row.
          actorId: userId,
          action: "org.invite.accept",
          subjectOwnerId: invite.org_id,
          subjectId: invite.org_id,
          granteeType: "user",
          granteeId: userId,
        });
        joined.push(invite.org_id);
      }
      return joined;
    },
  );

  return {
    async createOrg(input) {
      const id = input.id ?? crypto.randomUUID();
      if (userIdTaken.get(id)) {
        throw new Error("org id collides with an existing user");
      }
      const org: OrgRow = {
        id,
        slug: input.slug,
        name: input.name,
        created_by: input.createdBy,
        created_at: new Date().toISOString(),
      };
      insertOrg.run(org);
      return toOrg(org);
    },
    async getOrg(orgId) {
      const row = selectOrg.get(orgId) as OrgRow | undefined;
      return row ? toOrg(row) : null;
    },
    async getOrgBySlug(slug) {
      const row = selectOrgBySlug.get(slug) as OrgRow | undefined;
      return row ? toOrg(row) : null;
    },
    async addMember(orgId, userId, role, audit) {
      assertRole(role);
      addMemberTx(orgId, userId, role, audit);
    },
    async removeMember(orgId, userId, audit) {
      removeMemberTx(orgId, userId, audit);
    },
    async memberRole(orgId, userId) {
      const row = selectRole.get(orgId, userId) as
        | { role: OrgRole }
        | undefined;
      return row ? row.role : null;
    },
    async listOrgIdsForUser(userId) {
      const rows = selectOrgIds.all(userId) as Array<{ org_id: string }>;
      return rows.map((r) => r.org_id);
    },
    async listMembers(orgId) {
      const rows = selectMembers.all(orgId) as Array<{
        user_id: string;
        role: OrgRole;
        created_at: string;
      }>;
      return rows.map((r) => ({
        userId: r.user_id,
        role: r.role,
        createdAt: r.created_at,
      }));
    },
    async invite(orgId, githubLogin, role, audit) {
      assertRole(role);
      const login = canonicalizeGithubLogin(githubLogin);
      if (!login) throw new Error("github login is required");
      const now = new Date().toISOString();
      return toInvite(
        inviteTx(
          {
            org_id: orgId,
            github_login: login,
            role,
            invited_by: audit.actorId,
            created_at: now,
            expires_at: new Date(Date.now() + ORG_INVITE_TTL_MS).toISOString(),
            accepted_at: null,
          },
          audit,
        ),
      );
    },
    async listPendingInvites(orgId) {
      const rows = selectPendingForOrg.all({
        org_id: orgId,
        now: new Date().toISOString(),
      }) as InviteRow[];
      return rows.map(toInvite);
    },
    async acceptInvitesForLogin(userId, login) {
      const canonical = canonicalizeGithubLogin(login);
      if (!canonical) return [];
      return acceptInvitesTx(userId, canonical);
    },
  };
}
