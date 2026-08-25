import type Database from "better-sqlite3";
import { prepareAuditAppend, type AuditEntry } from "./audit-log-store";

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

export function createTeamsRepository(db: Database.Database): TeamsRepository {
  const insertTeam = db.prepare(`
    INSERT INTO teams (id, org_id, slug, name, created_by, created_at)
    VALUES (@id, @org_id, @slug, @name, @created_by, @created_at)
  `);
  const selectTeam = db.prepare("SELECT * FROM teams WHERE id = ?");
  const selectTeamBySlug = db.prepare(
    "SELECT * FROM teams WHERE org_id = ? AND slug = ?",
  );
  const selectTeamsForOrg = db.prepare(
    "SELECT * FROM teams WHERE org_id = ? ORDER BY slug",
  );
  const selectOrgMember = db.prepare(
    "SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?",
  );
  const upsertMember = db.prepare(`
    INSERT INTO team_members (team_id, user_id, created_at)
    VALUES (@team_id, @user_id, @created_at)
    ON CONFLICT(team_id, user_id) DO NOTHING
  `);
  const deleteMember = db.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
  );
  const selectMember = db.prepare(
    "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
  );
  const selectTeamIds = db.prepare(
    "SELECT team_id FROM team_members WHERE user_id = ? ORDER BY team_id",
  );

  const deleteTeamRow = db.prepare("DELETE FROM teams WHERE id = ?");
  const deleteAllMembers = db.prepare(
    "DELETE FROM team_members WHERE team_id = ?",
  );

  // The audit row is written INSIDE each mutation's transaction, not after it
  // by a separate awaited repository call. Two independent commits mean the
  // mutation can land while the audit write throws, and an unaudited change is
  // exactly the event the log exists to make impossible to miss.
  const appendAudit = prepareAuditAppend(db);
  const audited = (
    audit: TeamAuditContext | undefined,
    entry: Omit<AuditEntry, "actorId">,
  ) => {
    if (audit) appendAudit({ ...entry, actorId: audit.actorId });
  };

  const createTeamTx = db.transaction(
    (row: TeamRow, audit?: TeamAuditContext) => {
      insertTeam.run(row);
      audited(audit, {
        action: "team.create",
        subjectOwnerId: row.org_id,
        subjectId: row.id,
      });
    },
  );

  // Memberships go with the team, atomically: rows pointing at a team that no
  // longer exists would be invisible grants.
  const deleteTeamTx = db.transaction(
    (teamId: string, audit?: TeamAuditContext) => {
      const team = selectTeam.get(teamId) as TeamRow | undefined;
      deleteAllMembers.run(teamId);
      deleteTeamRow.run(teamId);
      audited(audit, {
        action: "team.delete",
        subjectOwnerId: team?.org_id ?? null,
        subjectId: teamId,
      });
    },
  );

  // Check-and-insert in ONE transaction: without it, an org removal
  // interleaving between the membership check and the insert would leave a
  // team row belonging to a user who is no longer in the org — precisely the
  // orphan the cascade exists to prevent.
  const addMemberTx = db.transaction(
    (teamId: string, userId: string, audit?: TeamAuditContext) => {
      const team = selectTeam.get(teamId) as TeamRow | undefined;
      if (!team) throw new UnknownTeamError(teamId);
      if (!selectOrgMember.get(team.org_id, userId)) {
        throw new NotAnOrgMemberError(teamId, userId);
      }
      upsertMember.run({
        team_id: teamId,
        user_id: userId,
        created_at: new Date().toISOString(),
      });
      audited(audit, {
        action: "team.member.add",
        subjectOwnerId: team.org_id,
        subjectId: teamId,
        granteeType: "user",
        granteeId: userId,
      });
    },
  );

  const removeMemberTx = db.transaction(
    (teamId: string, userId: string, audit?: TeamAuditContext) => {
      const team = selectTeam.get(teamId) as TeamRow | undefined;
      deleteMember.run(teamId, userId);
      audited(audit, {
        action: "team.member.remove",
        subjectOwnerId: team?.org_id ?? null,
        subjectId: teamId,
        granteeType: "user",
        granteeId: userId,
      });
    },
  );

  /**
   * The UNIQUE index on (org_id, slug) is the arbiter, not a prior SELECT.
   * better-sqlite3 surfaces the violation as SQLITE_CONSTRAINT_UNIQUE; a
   * read-then-write check in the route loses the race between two concurrent
   * creates and the loser would escape as a 500.
   */
  const isDuplicateSlug = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE" &&
    String((err as { message?: string }).message ?? "").includes("teams.slug");

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
        createTeamTx(row, audit);
      } catch (err) {
        if (isDuplicateSlug(err)) {
          throw new DuplicateTeamSlugError(input.orgId, input.slug);
        }
        throw err;
      }
      return toTeam(row);
    },
    async getTeam(teamId) {
      const row = selectTeam.get(teamId) as TeamRow | undefined;
      return row ? toTeam(row) : null;
    },
    async getTeamBySlug(orgId, slug) {
      const row = selectTeamBySlug.get(orgId, slug) as TeamRow | undefined;
      return row ? toTeam(row) : null;
    },
    async listTeamsForOrg(orgId) {
      return (selectTeamsForOrg.all(orgId) as TeamRow[]).map(toTeam);
    },
    async deleteTeam(teamId, audit) {
      deleteTeamTx(teamId, audit);
    },
    async addMember(teamId, userId, audit) {
      addMemberTx(teamId, userId, audit);
    },
    async removeMember(teamId, userId, audit) {
      removeMemberTx(teamId, userId, audit);
    },
    async isMember(teamId, userId) {
      return selectMember.get(teamId, userId) !== undefined;
    },
    async listTeamIdsForUser(userId) {
      const rows = selectTeamIds.all(userId) as Array<{ team_id: string }>;
      return rows.map((r) => r.team_id);
    },
  };
}
