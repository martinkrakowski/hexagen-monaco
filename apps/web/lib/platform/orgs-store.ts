import type { PlatformDb, PlatformDbSession } from "./db";
import { appendAudit, type AuditEntry } from "./audit-log-store";
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

/**
 * Unique index `idx_orgs_slug` rejected the slug.
 *
 * Raised from the index, not from a pre-check: a SELECT-then-INSERT loses the
 * race between two concurrent creates, and the second caller would see a raw
 * SqliteError instead of a 409. Unrelated constraint failures (a colliding
 * `orgs.id`) must not be mapped here.
 */
export class DuplicateOrgSlugError extends Error {
  readonly code = "duplicate_org_slug";
  constructor(readonly slug: string) {
    super(`org slug '${slug}' already exists`);
    this.name = "DuplicateOrgSlugError";
  }
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

/** One membership row for the org switcher — org identity plus the caller's role. */
export interface OrgMembershipSummary {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
}

/**
 * Deleting an org that still owns projects is refused (409 at the route).
 * Deleting customer data must be an explicit act — empty the org first —
 * never a cascade surprise. The count is carried so the refusal can say how
 * much is in the way.
 */
export class OrgOwnsProjectsError extends Error {
  readonly code = "org_owns_projects";
  constructor(
    readonly orgId: string,
    readonly projectCount: number,
  ) {
    super(
      `org ${orgId} still owns ${projectCount} project(s); move or delete them first`,
    );
    this.name = "OrgOwnsProjectsError";
  }
}

export interface OrgAuditActor {
  actorId: string;
}

export interface OrgsRepository {
  createOrg(input: {
    id?: string;
    slug: string;
    name: string;
    createdBy: string;
  }): Promise<Org>;
  /**
   * Create an org AND make `createdBy` its owner, atomically.
   *
   * An org with no owner is unreachable: nobody can administer it, invite to
   * it, or delete it, and `requireTenant` refuses every caller. Splitting the
   * two inserts would let a failure leave exactly that.
   *
   * @throws DuplicateOrgSlugError on the `idx_orgs_slug` unique-index conflict.
   */
  createOrgWithOwner(
    input: { id?: string; slug: string; name: string; createdBy: string },
    actor: OrgAuditContext,
  ): Promise<Org>;
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
  /**
   * The caller's orgs with their role, in one JOIN. `GET /api/orgs` lists
   * this rather than `listOrgIdsForUser` + per-id `getOrg`/`memberRole`.
   */
  listOrgsForUser(userId: string): Promise<OrgMembershipSummary[]>;
  /**
   * Tenancy-hygiene deletion. Refuses with {@link OrgOwnsProjectsError} while
   * the org owns projects — checked INSIDE the transaction, so a project
   * created concurrently cannot slip past a route-level pre-check. With zero
   * projects it removes, in ONE transaction: team memberships, teams, org
   * members, pending invites, soft-revokes every live grant whose GRANTEE is
   * this org or one of its teams (their access dies with them; the rows stay
   * for the audit trail), and finally the org row. The `org.delete` audit row
   * is written inside the same transaction and gated on the org row actually
   * being deleted.
   */
  deleteOrg(orgId: string, actor: OrgAuditActor): Promise<void>;
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

export function createOrgsRepository(db: PlatformDb): OrgsRepository {
  // B2: match the constraint name instead of the driver's message text.
  const isDuplicateOrgSlug = (err: unknown): boolean => {
    if (!db.isUniqueViolation(err)) return false;
    const message = err instanceof Error ? err.message : "";
    return (
      /UNIQUE constraint failed: orgs\.slug/i.test(message) ||
      /idx_orgs_slug/i.test(message)
    );
  };

  const insertOrg = `
    INSERT INTO orgs (id, slug, name, created_by, created_at)
    VALUES (@id, @slug, @name, @created_by, @created_at)
  `;
  const userIdTaken = "SELECT 1 AS ok FROM users WHERE id = ?";
  const selectOrg = "SELECT * FROM orgs WHERE id = ?";
  const selectOrgBySlug = "SELECT * FROM orgs WHERE slug = ?";
  const upsertMember = `
    INSERT INTO org_members (org_id, user_id, role, created_at)
    VALUES (@org_id, @user_id, @role, @created_at)
    ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role
  `;
  // Promote-never-demote at acceptance: an owner-level invite to someone who
  // joined as a member in the meantime lands the promotion; a member-level
  // invite to someone who became an owner changes nothing. Both directions
  // are asserted in org-members.guard.test.
  const insertMemberIfAbsent = `
    INSERT INTO org_members (org_id, user_id, role, created_at)
    VALUES (@org_id, @user_id, @role, @created_at)
    ON CONFLICT(org_id, user_id) DO UPDATE SET role = 'owner'
      WHERE excluded.role = 'owner' AND org_members.role = 'member' 
  `;
  const deleteMember =
    "DELETE FROM org_members WHERE org_id = ? AND user_id = ?";
  const selectMemberRow =
    "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?";
  const countOwners =
    "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'owner'";
  const selectMembers =
    "SELECT user_id, role, created_at FROM org_members WHERE org_id = ? ORDER BY created_at, user_id";
  // P-A2: leaving an org leaves every team in it. A team membership that
  // outlived its org membership would be a live grant nobody can see from the
  // org page or revoke from it.
  const deleteTeamMemberships = `
    DELETE FROM team_members
    WHERE user_id = ?
      AND team_id IN (SELECT id FROM teams WHERE org_id = ?)
  `;
  // Org, owner membership and audit row in ONE transaction. An org whose
  // owner insert failed is administerable by nobody and refused by
  // requireTenant for everybody — a row that exists and cannot be used.
  const assertNotAUserId = async (
    session: PlatformDbSession,
    id: string,
  ): Promise<void> => {
    const taken = await session.get<{ ok: number }>(userIdTaken, [id]);
    if (taken) throw new Error("org id collides with an existing user");
  };

  const createOrgWithOwnerTx = (row: OrgRow, actorId: string): Promise<Org> =>
    db.transaction(async (tx) => {
      // The id check belongs with the insert it guards: on the synchronous
      // driver nothing could come between the two.
      await assertNotAUserId(tx, row.id);
      try {
        await tx.run(insertOrg, {
          id: row.id,
          slug: row.slug,
          name: row.name,
          created_by: row.created_by,
          created_at: row.created_at,
        });
      } catch (err) {
        if (isDuplicateOrgSlug(err)) {
          throw new DuplicateOrgSlugError(row.slug);
        }
        throw err;
      }
      await tx.run(upsertMember, {
        org_id: row.id,
        user_id: row.created_by,
        role: "owner",
        created_at: row.created_at,
      });
      await appendAudit(tx, {
        actorId,
        action: "org.create",
        subjectOwnerId: row.id,
        subjectId: row.id,
      });
      return toOrg(row);
    });

  // JOIN orgs so a membership row whose org_id is not an org (the FK
  // constraint, or a connection that forgot PRAGMA foreign_keys) cannot
  // authorize requireTenant against a personal owner id.
  const selectRole = `
    SELECT m.role FROM org_members m
     INNER JOIN orgs o ON o.id = m.org_id
     WHERE m.org_id = ? AND m.user_id = ?
  `;
  const selectOrgIds = `
    SELECT m.org_id FROM org_members m
     INNER JOIN orgs o ON o.id = m.org_id
     WHERE m.user_id = ?
      ORDER BY m.org_id
  `;
  // Same JOIN as listOrgIdsForUser: a membership whose org_id is not an org
  // cannot appear in the switcher. Role comes from the membership row so
  // GET /api/orgs is one statement, not 2N+1.
  const selectOrgsForUser = `
    SELECT o.id, o.slug, o.name, m.role
      FROM org_members m
      INNER JOIN orgs o ON o.id = m.org_id
     WHERE m.user_id = ?
      ORDER BY m.org_id
  `;

  const selectInvite =
    "SELECT * FROM org_invites WHERE org_id = ? AND github_login = ?";
  // Only a PENDING invite is re-writable. Once accepted the row is history:
  // overwriting it would let a re-invite silently reset `accepted_at` and
  // re-grant on the next sign-in.
  const upsertInvite = `
    INSERT INTO org_invites (org_id, github_login, role, invited_by, created_at, expires_at, accepted_at)
    VALUES (@org_id, @github_login, @role, @invited_by, @created_at, @expires_at, NULL)
    ON CONFLICT(org_id, github_login) DO UPDATE
      SET role = excluded.role,
          invited_by = excluded.invited_by,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
    WHERE org_invites.accepted_at IS NULL
  `;
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
  const selectPendingForLogin =
    "SELECT * FROM org_invites WHERE github_login = @login AND accepted_at IS NULL AND expires_at > @now ORDER BY org_id";
  const selectPendingForOrg =
    "SELECT * FROM org_invites WHERE org_id = @org_id AND accepted_at IS NULL AND expires_at > @now ORDER BY github_login";
  const markAccepted = `
    UPDATE org_invites SET accepted_at = @accepted_at
     WHERE org_id = @org_id AND github_login = @github_login
       AND accepted_at IS NULL
  `;

  // The audit row is written INSIDE each mutation's transaction, not after it
  // by a separate awaited repository call. Two independent commits mean the
  // mutation can land while the audit write throws, and an unaudited
  // membership change is exactly the event the log exists to make impossible
  // to miss.
  const audited = async (
    session: PlatformDbSession,
    audit: OrgAuditContext | undefined,
    entry: Omit<AuditEntry, "actorId">,
  ) => {
    if (audit) await appendAudit(session, { ...entry, actorId: audit.actorId });
  };

  /** @throws LastOwnerError */
  const guardLastOwner = async (
    session: PlatformDbSession,
    orgId: string,
    userId: string,
    was: OrgRole,
  ) => {
    if (was !== "owner") return;
    const row = await session.get<{ n: number }>(countOwners, [orgId]);
    if (!row || row.n <= 1) throw new LastOwnerError(orgId, userId);
  };

  const addMemberTx = (
    orgId: string,
    userId: string,
    role: OrgRole,
    audit?: OrgAuditContext,
  ): Promise<void> =>
    db.transaction(async (tx) => {
      const existing = await tx.get<{ role: OrgRole }>(selectMemberRow, [
        orgId,
        userId,
      ]);

      // A re-add at the SAME role changes nothing. `ON CONFLICT DO UPDATE SET
      // role = excluded.role` still reports changes = 1 for it, so the
      // `.changes > 0` gate teams-store relies on is NOT sufficient here — it
      // would write a "role changed" row for a role that did not change.
      // Comparing before the write is what makes the audit trail honest.
      if (existing?.role === role) return;

      if (existing) await guardLastOwner(tx, orgId, userId, existing.role);

      await tx.run(upsertMember, {
        org_id: orgId,
        user_id: userId,
        role,
        created_at: new Date().toISOString(),
      });
      await audited(tx, audit, {
        // A role change is not an add: conflating them would make the trail
        // unable to answer "when did this person become an owner".
        action: existing ? "org.member.role_change" : "org.member.add",
        subjectOwnerId: orgId,
        subjectId: orgId,
        granteeType: "user",
        granteeId: userId,
      });
    });

  // ONE transaction, so a failure in either statement rolls back both: a user
  // dropped from the org but left in its teams is the orphan this prevents,
  // and the reverse (teams cleared, org row surviving) is just as wrong.
  const removeMemberTx = (
    orgId: string,
    userId: string,
    audit?: OrgAuditContext,
  ): Promise<void> =>
    db.transaction(async (tx) => {
      const existing = await tx.get<{ role: OrgRole }>(selectMemberRow, [
        orgId,
        userId,
      ]);
      if (existing) await guardLastOwner(tx, orgId, userId, existing.role);

      await tx.run(deleteTeamMemberships, [userId, orgId]);
      const removed = await tx.run(deleteMember, [orgId, userId]);
      // Gate on affected rows: an audit row for a removal that hit nothing
      // records an event that did not happen, and a reader cannot tell it from
      // a real removal.
      if (removed.changes > 0)
        await audited(tx, audit, {
          action: "org.member.remove",
          subjectOwnerId: orgId,
          subjectId: orgId,
          granteeType: "user",
          granteeId: userId,
        });
    });

  const inviteTx = (
    row: InviteRow,
    audit: OrgAuditContext,
  ): Promise<InviteRow> =>
    db.transaction(async (tx) => {
      const existing = await tx.get<InviteRow>(selectInvite, [
        row.org_id,
        row.github_login,
      ]);

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

      await tx.run(upsertInvite, {
        org_id: row.org_id,
        github_login: row.github_login,
        role: row.role,
        invited_by: row.invited_by,
        created_at: row.created_at,
        expires_at: row.expires_at,
        accepted_at: row.accepted_at,
      });
      await audited(tx, audit, {
        action: "org.invite",
        subjectOwnerId: row.org_id,
        subjectId: row.org_id,
        // The invitee has no user id yet — that is the whole reason this row
        // exists — so the grantee is the handle itself.
        granteeType: "github_login",
        granteeId: row.github_login,
      });
      return row;
    });

  // Membership + acceptance stamp in ONE transaction. Split across two
  // commits, a crash between them leaves either an invite marked accepted with
  // no membership (silently lost access, and never retried because the
  // pending-invite query no longer matches it) or a membership whose invite
  // stays pending and re-grants on every future sign-in.
  const acceptInvitesTx = (userId: string, login: string): Promise<string[]> =>
    db.transaction(async (tx) => {
      const now = new Date().toISOString();
      const pending = await tx.all<InviteRow>(selectPendingForLogin, {
        login,
        now,
      });
      const joined: string[] = [];
      for (const invite of pending) {
        // Stamp first and gate on it: if two sign-ins race, only the one whose
        // UPDATE matched `accepted_at IS NULL` writes the membership and the
        // audit row, so acceptance is recorded exactly once.
        const stamped = await tx.run(markAccepted, {
          accepted_at: now,
          org_id: invite.org_id,
          github_login: invite.github_login,
        });
        if (stamped.changes === 0) continue;
        await tx.run(insertMemberIfAbsent, {
          org_id: invite.org_id,
          user_id: userId,
          role: invite.role,
          created_at: now,
        });
        await appendAudit(tx, {
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
    });

  const countOwnedProjects =
    "SELECT COUNT(*) AS n FROM saved_projects WHERE owner_id = ?";
  const deleteOrgTeamMembers = `
    DELETE FROM team_members
    WHERE team_id IN (SELECT id FROM teams WHERE org_id = ?)
  `;
  const deleteOrgTeams = "DELETE FROM teams WHERE org_id = ?";
  const deleteOrgMembers = "DELETE FROM org_members WHERE org_id = ?";
  const deleteOrgInvites = "DELETE FROM org_invites WHERE org_id = ?";
  // Soft-revoke, not row deletion: the grant rows are the audit trail of who
  // had access; what must die with the org is the ACCESS, i.e. liveness.
  const revokeGrantsToOrgAndTeams = `
    UPDATE project_shares SET revoked_at = @revoked_at
    WHERE revoked_at IS NULL
      AND (
        (grantee_type = 'org' AND grantee_id = @org_id)
        OR (
          grantee_type = 'team'
          AND grantee_id IN (SELECT id FROM teams WHERE org_id = @org_id)
        )
      )
   `;
  // Owner-side liveness dies with the org too: the schema does not force a
  // share row's project to exist in saved_projects, so "zero owned projects"
  // does not imply "zero live owner-side grants". Revoking by owner_id closes
  // that gap (review flag on #658).
  const revokeGrantsOwnedByOrg = `
    UPDATE project_shares SET revoked_at = @revoked_at
    WHERE owner_id = @org_id AND revoked_at IS NULL
  `;
  // Run telemetry is owner-scoped operational data, not an audit trail; with
  // the tenant gone it is unreachable through every access path, so leaving
  // it would be orphaned customer data, not history (review flag on #658).
  const deleteRunEvents = "DELETE FROM run_events WHERE owner_id = ?";
  const deleteOrgRow = "DELETE FROM orgs WHERE id = ?";
  const deleteOrgTx = (orgId: string, actorId: string): Promise<void> =>
    db.transaction(async (tx) => {
      // Inside the transaction, so the count and the deletes are one atomic
      // view — a concurrent project create either lands before (refusal) or
      // after (harmless: the owner row no longer exists to authorize writes).
      const owned = await tx.get<{ n: number }>(countOwnedProjects, [orgId]);
      if (owned && owned.n > 0) throw new OrgOwnsProjectsError(orgId, owned.n);
      // Grants revoked BEFORE the teams rows go — the team subquery needs them.
      const revokedAt = new Date().toISOString();
      await tx.run(revokeGrantsToOrgAndTeams, {
        org_id: orgId,
        revoked_at: revokedAt,
      });
      await tx.run(revokeGrantsOwnedByOrg, {
        org_id: orgId,
        revoked_at: revokedAt,
      });
      await tx.run(deleteRunEvents, [orgId]);
      await tx.run(deleteOrgTeamMembers, [orgId]);
      await tx.run(deleteOrgTeams, [orgId]);
      await tx.run(deleteOrgInvites, [orgId]);
      await tx.run(deleteOrgMembers, [orgId]);
      const removed = await tx.run(deleteOrgRow, [orgId]);
      // Gate on affected rows (P-A2's rule): an org.delete row for an org that
      // did not exist would be a record of an event that never happened.
      if (removed.changes > 0) {
        await appendAudit(tx, {
          actorId,
          action: "org.delete",
          subjectOwnerId: orgId,
          subjectId: orgId,
        });
      }
    });

  return {
    async createOrg(input) {
      const id = input.id ?? crypto.randomUUID();
      const org: OrgRow = {
        id,
        slug: input.slug,
        name: input.name,
        created_by: input.createdBy,
        created_at: new Date().toISOString(),
      };
      await db.transaction(async (tx) => {
        await assertNotAUserId(tx, id);
        await tx.run(insertOrg, {
          id: org.id,
          slug: org.slug,
          name: org.name,
          created_by: org.created_by,
          created_at: org.created_at,
        });
      });
      return toOrg(org);
    },
    async createOrgWithOwner(input, actor) {
      const id = input.id ?? crypto.randomUUID();
      return createOrgWithOwnerTx(
        {
          id,
          slug: input.slug,
          name: input.name,
          created_by: input.createdBy,
          created_at: new Date().toISOString(),
        },
        actor.actorId,
      );
    },
    async getOrg(orgId) {
      const row = await db.get<OrgRow>(selectOrg, [orgId]);
      return row ? toOrg(row) : null;
    },
    async getOrgBySlug(slug) {
      const row = await db.get<OrgRow>(selectOrgBySlug, [slug]);
      return row ? toOrg(row) : null;
    },
    async addMember(orgId, userId, role, audit) {
      assertRole(role);
      await addMemberTx(orgId, userId, role, audit);
    },
    async removeMember(orgId, userId, audit) {
      await removeMemberTx(orgId, userId, audit);
    },
    async memberRole(orgId, userId) {
      const row = await db.get<{ role: OrgRole }>(selectRole, [orgId, userId]);
      return row ? row.role : null;
    },
    async deleteOrg(orgId, actor) {
      await deleteOrgTx(orgId, actor.actorId);
    },
    async listOrgIdsForUser(userId) {
      const rows = await db.all<{ org_id: string }>(selectOrgIds, [userId]);
      return rows.map((r) => r.org_id);
    },
    async listMembers(orgId) {
      const rows = await db.all<{
        user_id: string;
        role: OrgRole;
        created_at: string;
      }>(selectMembers, [orgId]);
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
        await inviteTx(
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
      const rows = await db.all<InviteRow>(selectPendingForOrg, {
        org_id: orgId,
        now: new Date().toISOString(),
      });
      return rows.map(toInvite);
    },
    async acceptInvitesForLogin(userId, login) {
      const canonical = canonicalizeGithubLogin(login);
      if (!canonical) return [];
      return acceptInvitesTx(userId, canonical);
    },
    async listOrgsForUser(userId) {
      const rows = await db.all<{
        id: string;
        slug: string;
        name: string;
        role: OrgRole;
      }>(selectOrgsForUser, [userId]);
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        role: r.role,
      }));
    },
  };
}
