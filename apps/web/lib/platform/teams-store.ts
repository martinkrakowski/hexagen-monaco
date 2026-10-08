import type { PlatformDb, PlatformDbSession } from "./db";
import { appendAudit, type AuditEntry } from "./audit-log-store";

/**
 * Teams and their membership (P-A2).
 *
 * A team is a GRANTEE GROUPING, never an owner (D-A1). Nothing here ever
 * writes a team id into `owner_id`: a project has exactly one owner, a user
 * or an org, and teams appear only on the grant side (`project_shares`,
 * P-A4). That is what keeps every ownership statement in
 * `saved-projects-store` unchanged.
 *
 * ASYNC BY DECISION (D-A9), like `orgs-store`: better-sqlite3 is synchronous,
 * but the Postgres move's real cost is the sync→async contract change across
 * callers, and new surface must not add to that bill.
 */

/**
 * A team membership was requested for a user who is not in the team's org.
 *
 * Thrown by the STORE, not checked only at the route: the invariant is a
 * property of the data, and a second caller (an invite acceptance, a future
 * bulk import) must not be able to bypass it by not knowing about it. The
 * route layer turns this into 409.
 */
export class NotAnOrgMemberError extends Error {
  readonly code = "not_an_org_member";
  constructor(
    readonly teamId: string,
    readonly userId: string,
  ) {
    super(`user ${userId} is not a member of the org that owns team ${teamId}`);
    this.name = "NotAnOrgMemberError";
  }
}

/** The referenced team does not exist. */
export class UnknownTeamError extends Error {
  readonly code = "unknown_team";
  constructor(readonly teamId: string) {
    super(`team ${teamId} does not exist`);
    this.name = "UnknownTeamError";
  }
}

/**
 * A team slug already exists in the org.
 *
 * Raised by the STORE from the UNIQUE index, not by a read-then-write check in
 * the route: two concurrent creates both pass a pre-check and the second would
 * otherwise surface a raw SqliteError as a 500. The index is the arbiter; this
 * turns its verdict into something the route can map to 409.
 */
export class DuplicateTeamSlugError extends Error {
  readonly code = "duplicate_team_slug";
  constructor(
    readonly orgId: string,
    readonly slug: string,
  ) {
    super(`team slug '${slug}' already exists in org ${orgId}`);
    this.name = "DuplicateTeamSlugError";
  }
}

export interface Team {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Who performed a mutation, so the store can write its audit row inside the
 * SAME transaction (D-A6).
 *
 * The store owns the action vocabulary and the subject ids — the caller only
 * says who. Passing the whole `AuditEntry` from a route would let two callers
 * disagree about what a team deletion is called.
 */
export interface TeamAuditContext {
  actorId: string;
}

export interface TeamsRepository {
  createTeam(
    input: {
      id?: string;
      orgId: string;
      slug: string;
      name: string;
      createdBy: string;
    },
    audit?: TeamAuditContext,
  ): Promise<Team>;
  getTeam(teamId: string): Promise<Team | null>;
  /** Resolves the `@org-slug/team-slug` share handle (P-A4). */
  getTeamBySlug(orgId: string, slug: string): Promise<Team | null>;
  listTeamsForOrg(orgId: string): Promise<Team[]>;
  /** Deletes the team and its memberships atomically. */
  deleteTeam(teamId: string, audit?: TeamAuditContext): Promise<void>;
  /** @throws NotAnOrgMemberError | UnknownTeamError */
  addMember(
    teamId: string,
    userId: string,
    audit?: TeamAuditContext,
  ): Promise<void>;
  removeMember(
    teamId: string,
    userId: string,
    audit?: TeamAuditContext,
  ): Promise<void>;
  isMember(teamId: string, userId: string): Promise<boolean>;
  /** P-A3 reads this on every shared-project request. */
  listTeamIdsForUser(userId: string): Promise<string[]>;
}

interface TeamRow {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  created_by: string;
  created_at: string;
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    orgId: row.org_id,
    slug: row.slug,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function createTeamsRepository(db: PlatformDb): TeamsRepository {
  const insertTeam = `
    INSERT INTO teams (id, org_id, slug, name, created_by, created_at)
    VALUES (@id, @org_id, @slug, @name, @created_by, @created_at)
  `;
  const selectTeam = "SELECT * FROM teams WHERE id = ?";
  const selectTeamBySlug = "SELECT * FROM teams WHERE org_id = ? AND slug = ?";
  const selectTeamsForOrg =
    "SELECT * FROM teams WHERE org_id = ? ORDER BY slug";
  const selectOrgMember =
    "SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?";
  const upsertMember = `
    INSERT INTO team_members (team_id, user_id, created_at)
    VALUES (@team_id, @user_id, @created_at)
    ON CONFLICT(team_id, user_id) DO NOTHING
  `;
  const deleteMember =
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?";
  const selectMember =
    "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?";
  const selectTeamIds =
    "SELECT team_id FROM team_members WHERE user_id = ? ORDER BY team_id";
  const deleteTeamRow = "DELETE FROM teams WHERE id = ?";
  const deleteAllMembers =
    "DELETE FROM team_members WHERE team_id = ?";

  // The audit row is written INSIDE each mutation's transaction, not after it
  // by a separate awaited repository call. Two independent commits mean the
  // mutation can land while the audit write throws, and an unaudited change is
  // exactly the event the log exists to make impossible to miss.
  const audited = async (
    session: PlatformDbSession,
    audit: TeamAuditContext | undefined,
    entry: Omit<AuditEntry, "actorId">,
  ) => {
    if (audit) await appendAudit(session, { ...entry, actorId: audit.actorId });
  };

  const createTeamTx = (
    row: TeamRow,
    audit?: TeamAuditContext,
  ): Promise<void> =>
    db.transaction(async (tx) => {
      await tx.run(insertTeam, {
        id: row.id,
        org_id: row.org_id,
        slug: row.slug,
        name: row.name,
        created_by: row.created_by,
        created_at: row.created_at,
      });
      await audited(tx, audit, {
        action: "team.create",
        subjectOwnerId: row.org_id,
        subjectId: row.id,
      });
    });

  // Memberships go with the team, atomically: rows pointing at a team that no
  // longer exists would be invisible grants.
  const deleteTeamTx = (
    teamId: string,
    audit?: TeamAuditContext,
  ): Promise<void> =>
    db.transaction(async (tx) => {
      const team = await tx.get<TeamRow | undefined>(selectTeam, [teamId]);
      await tx.run(deleteAllMembers, [teamId]);
      const removed = await tx.run(deleteTeamRow, [teamId]);
      // Gate on affected rows: an audit row for a delete that hit nothing is a
      // record of an event that did not happen, which is worse than a missing
      // one — a reader cannot tell it from a real deletion.
      if (removed.changes > 0)
        await audited(tx, audit, {
          action: "team.delete",
          subjectOwnerId: team?.org_id ?? null,
          subjectId: teamId,
        });
    });

  // Check-and-insert in ONE transaction: without it, an org removal
  // interleaving between the membership check and the insert would leave a
  // team row belonging to a user who is no longer in the org — precisely the
  // orphan the cascade exists to prevent.
  const addMemberTx = (
    teamId: string,
    userId: string,
    audit?: TeamAuditContext,
  ): Promise<void> =>
    db.transaction(async (tx) => {
      const team = await tx.get<TeamRow | undefined>(selectTeam, [teamId]);
      if (!team) throw new UnknownTeamError(teamId);
      const orgMember = await tx.get<{ ok: number }>(selectOrgMember, [
        team.org_id,
        userId,
      ]);
      if (!orgMember) {
        throw new NotAnOrgMemberError(teamId, userId);
      }
      const inserted = await tx.run(upsertMember, {
        team_id: teamId,
        user_id: userId,
        created_at: new Date().toISOString(),
      });
      // ON CONFLICT DO NOTHING: a duplicate add changes nothing, so recording
      // "member added" would be a false entry.
      if (inserted.changes > 0)
        await audited(tx, audit, {
          action: "team.member.add",
          subjectOwnerId: team.org_id,
          subjectId: teamId,
          granteeType: "user",
          granteeId: userId,
        });
    });

  const removeMemberTx = (
    teamId: string,
    userId: string,
    audit?: TeamAuditContext,
  ): Promise<void> =>
    db.transaction(async (tx) => {
      const team = await tx.get<TeamRow | undefined>(selectTeam, [teamId]);
      const removedMember = await tx.run(deleteMember, [teamId, userId]);
      if (removedMember.changes > 0)
        await audited(tx, audit, {
          action: "team.member.remove",
          subjectOwnerId: team?.org_id ?? null,
          subjectId: teamId,
          granteeType: "user",
          granteeId: userId,
        });
    });

  /**
   * The UNIQUE index on (org_id, slug) is the arbiter, not a prior SELECT.
   * better-sqlite3 surfaces the violation as SQLITE_CONSTRAINT_UNIQUE; a
   * read-then-write check in the route loses the race between two concurrent
   * creates and the loser would escape as a 500.
   */
  const isDuplicateSlug = (err: unknown): boolean =>
    db.isUniqueViolation(err) &&
    String((err as { message?: unknown }).message ?? "").includes("teams.slug");

  return {
    async createTeam(input, audit) {
      const row: TeamRow = {
        id: input.id ?? crypto.randomUUID(),
        org_id: input.orgId,
        slug: input.slug,
        name: input.name,
        created_by: input.createdBy,
        created_at: new Date().toISOString(),
      };
      try {
        await createTeamTx(row, audit);
      } catch (err) {
        if (isDuplicateSlug(err)) {
          throw new DuplicateTeamSlugError(input.orgId, input.slug);
        }
        throw err;
      }
      return toTeam(row);
    },
    async getTeam(teamId) {
      const row = await db.get<TeamRow | undefined>(selectTeam, [teamId]);
      return row ? toTeam(row) : null;
    },
    async getTeamBySlug(orgId, slug) {
      const row = await db.get<TeamRow | undefined>(selectTeamBySlug, [
        orgId,
        slug,
      ]);
      return row ? toTeam(row) : null;
    },
    async listTeamsForOrg(orgId) {
      const rows = await db.all<TeamRow>(selectTeamsForOrg, [orgId]);
      return rows.map(toTeam);
    },
    async deleteTeam(teamId, audit) {
      await deleteTeamTx(teamId, audit);
    },
    async addMember(teamId, userId, audit) {
      await addMemberTx(teamId, userId, audit);
    },
    async removeMember(teamId, userId, audit) {
      await removeMemberTx(teamId, userId, audit);
    },
    async isMember(teamId, userId) {
      const row = await db.get<{ ok: number }>(selectMember, [teamId, userId]);
      return row !== undefined;
    },
    async listTeamIdsForUser(userId) {
      const rows = await db.all<{ team_id: string }>(selectTeamIds, [userId]);
      return rows.map((r) => r.team_id);
    },
  };
}
