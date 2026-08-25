import type Database from "better-sqlite3";

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

export interface Team {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface TeamsRepository {
  createTeam(input: {
    id?: string;
    orgId: string;
    slug: string;
    name: string;
    createdBy: string;
  }): Promise<Team>;
  getTeam(teamId: string): Promise<Team | null>;
  /** Resolves the `@org-slug/team-slug` share handle (P-A4). */
  getTeamBySlug(orgId: string, slug: string): Promise<Team | null>;
  listTeamsForOrg(orgId: string): Promise<Team[]>;
  /** Deletes the team and its memberships atomically. */
  deleteTeam(teamId: string): Promise<void>;
  /** @throws NotAnOrgMemberError | UnknownTeamError */
  addMember(teamId: string, userId: string): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;
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
  // Memberships go with the team, atomically: rows pointing at a team that no
  // longer exists would be invisible grants.
  const deleteTeamTx = db.transaction((teamId: string) => {
    deleteAllMembers.run(teamId);
    deleteTeamRow.run(teamId);
  });

  // Check-and-insert in ONE transaction: without it, an org removal
  // interleaving between the membership check and the insert would leave a
  // team row belonging to a user who is no longer in the org — precisely the
  // orphan the cascade exists to prevent.
  const addMemberTx = db.transaction((teamId: string, userId: string) => {
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
  });

  return {
    async createTeam(input) {
      const row: TeamRow = {
        id: input.id ?? crypto.randomUUID(),
        org_id: input.orgId,
        slug: input.slug,
        name: input.name,
        created_by: input.createdBy,
        created_at: new Date().toISOString(),
      };
      insertTeam.run(row);
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
    async deleteTeam(teamId) {
      deleteTeamTx(teamId);
    },
    async addMember(teamId, userId) {
      addMemberTx(teamId, userId);
    },
    async removeMember(teamId, userId) {
      deleteMember.run(teamId, userId);
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
