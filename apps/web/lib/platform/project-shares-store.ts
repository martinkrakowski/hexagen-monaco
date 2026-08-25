import type Database from "better-sqlite3";

/**
 * Grants on a project (P-A3).
 *
 * A grant is NOT ownership. `saved_projects` keeps its `PK (owner_id, id)` and
 * every statement in `saved-projects-store` stays `WHERE owner_id = ?`; this
 * table sits beside it and answers a different question — who ELSE may reach
 * a row. That separation is what keeps the owner store untouched: access
 * resolution happens once per request, and the owner-scoped store is then
 * built for the project's real owner.
 *
 * ASYNC BY DECISION (D-A9), like `orgs-store` and `teams-store`.
 */

/** Who a grant is made to. A team is a grantee, never an owner (D-A1). */
export type GranteeType = "user" | "org" | "team";

/** What a grant confers. Two roles only (D-A2); `owner` is not a grant. */
export type ShareRole = "read" | "write";

/**
 * Synchronous revoke-all for ONE project, for enlisting in another store's
 * transaction (the prepareAuditAppend pattern). Deleting a project must
 * revoke its grants IN THE SAME TRANSACTION: project_shares has no FK
 * cascade and accessFor does not join saved_projects, so a surviving live
 * grant re-applies to any future project recreated under the same
 * (owner_id, id) — a ghost grant the new project's owner never made
 * (review flag on #652). Soft revoke, so the audit trail survives.
 */
export function prepareShareRevokeAllForProject(
  db: Database.Database,
): (ownerId: string, projectId: string) => number {
  const stmt = db.prepare(`
    UPDATE project_shares
       SET revoked_at = @revoked_at
     WHERE owner_id = @owner_id AND project_id = @project_id
       AND revoked_at IS NULL
  `);
  return (ownerId, projectId) =>
    stmt.run({
      owner_id: ownerId,
      project_id: projectId,
      revoked_at: new Date().toISOString(),
    }).changes;
}

export interface ProjectShare {
  ownerId: string;
  projectId: string;
  granteeType: GranteeType;
  granteeId: string;
  role: ShareRole;
  grantedBy: string;
  createdAt: string;
  revokedAt: string | null;
}

/** A live grant reaching the caller, with the project's real owner. */
export interface SharedProjectGrant {
  ownerId: string;
  projectId: string;
  role: ShareRole;
  granteeType: GranteeType;
  granteeId: string;
}

/** The caller's grantee identities: themselves, their orgs, their teams. */
export interface GranteeIdentity {
  userId: string;
  orgIds: readonly string[];
  teamIds: readonly string[];
}

export interface ProjectSharesRepository {
  /**
   * Create or re-open a grant. Re-granting a revoked pair clears `revoked_at`
   * rather than inserting a duplicate — the PK is the (owner, project,
   * grantee) triple, so a share/revoke/re-share cycle is one row whose history
   * lives in `audit_log`.
   */
  grant(input: {
    ownerId: string;
    projectId: string;
    granteeType: GranteeType;
    granteeId: string;
    role: ShareRole;
    grantedBy: string;
  }): Promise<void>;

  /** Soft-revoke. Idempotent: revoking an already-revoked grant is a no-op. */
  revoke(input: {
    ownerId: string;
    projectId: string;
    granteeType: GranteeType;
    granteeId: string;
  }): Promise<void>;

  /** Live grants on one project, for the owner's manage-shares view. */
  listForProject(ownerId: string, projectId: string): Promise<ProjectShare[]>;

  /**
   * The strongest live grant this caller holds on one project, or null.
   *
   * "Strongest" matters: a user may reach the same project through a direct
   * grant AND an org AND a team, and those roles can differ. Returning the
   * highest (write > read) is the only answer that does not depend on row
   * order — the alternative silently varies with insertion history.
   */
  accessFor(
    ownerId: string,
    projectId: string,
    identity: GranteeIdentity,
  ): Promise<ShareRole | null>;

  /** Every live grant reaching this caller, across owners (shared-with-me). */
  selectSharedWith(identity: GranteeIdentity): Promise<SharedProjectGrant[]>;
}

interface ShareRow {
  owner_id: string;
  project_id: string;
  grantee_type: string;
  grantee_id: string;
  role: string;
  granted_by: string;
  created_at: string;
  revoked_at: string | null;
}

function toShare(row: ShareRow): ProjectShare {
  return {
    ownerId: row.owner_id,
    projectId: row.project_id,
    granteeType: row.grantee_type as GranteeType,
    granteeId: row.grantee_id,
    role: row.role as ShareRole,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * SQLite has no array parameter, so the `IN (...)` lists are built from
 * placeholders sized to the caller's identity. The values are still bound, not
 * interpolated — only the placeholder COUNT is dynamic.
 */
function placeholders(n: number): string {
  return new Array(n).fill("?").join(", ");
}

export function createProjectSharesRepository(
  db: Database.Database,
): ProjectSharesRepository {
  const upsert = db.prepare(`
    INSERT INTO project_shares
      (owner_id, project_id, grantee_type, grantee_id, role, granted_by, created_at, revoked_at)
    VALUES (@ownerId, @projectId, @granteeType, @granteeId, @role, @grantedBy, @createdAt, NULL)
    ON CONFLICT (owner_id, project_id, grantee_type, grantee_id) DO UPDATE SET
      role = excluded.role,
      granted_by = excluded.granted_by,
      revoked_at = NULL
  `);

  const revokeOne = db.prepare(`
    UPDATE project_shares SET revoked_at = @revokedAt
    WHERE owner_id = @ownerId AND project_id = @projectId
      AND grantee_type = @granteeType AND grantee_id = @granteeId
      AND revoked_at IS NULL
  `);

  const selectForProject = db.prepare(
    "SELECT * FROM project_shares WHERE owner_id = ? AND project_id = ? AND revoked_at IS NULL",
  );

  return {
    async grant(input) {
      upsert.run({ ...input, createdAt: new Date().toISOString() });
    },

    async revoke(input) {
      revokeOne.run({ ...input, revokedAt: new Date().toISOString() });
    },

    async listForProject(ownerId, projectId) {
      const rows = selectForProject.all(ownerId, projectId) as ShareRow[];
      return rows.map(toShare);
    },

    async accessFor(ownerId, projectId, identity) {
      const { userId, orgIds, teamIds } = identity;
      // `write` sorts before `read` alphabetically only by accident; order it
      // explicitly so the strongest grant wins regardless of collation.
      const sql = `
        SELECT role FROM project_shares
        WHERE owner_id = ? AND project_id = ? AND revoked_at IS NULL
          AND ( (grantee_type = 'user' AND grantee_id = ?)
             ${orgIds.length ? `OR (grantee_type = 'org' AND grantee_id IN (${placeholders(orgIds.length)}))` : ""}
             ${teamIds.length ? `OR (grantee_type = 'team' AND grantee_id IN (${placeholders(teamIds.length)}))` : ""} )
        ORDER BY CASE role WHEN 'write' THEN 0 ELSE 1 END
        LIMIT 1
      `;
      const row = db
        .prepare(sql)
        .get(ownerId, projectId, userId, ...orgIds, ...teamIds) as
        | { role: string }
        | undefined;
      return row ? (row.role as ShareRole) : null;
    },

    async selectSharedWith(identity) {
      const { userId, orgIds, teamIds } = identity;
      // Joined to saved_projects so a grant pointing at a deleted project does
      // not surface as a phantom entry in someone's shared list.
      const sql = `
        SELECT s.owner_id, s.project_id, s.role, s.grantee_type, s.grantee_id
        FROM project_shares s
        JOIN saved_projects p ON p.owner_id = s.owner_id AND p.id = s.project_id
        WHERE s.revoked_at IS NULL
          AND ( (s.grantee_type = 'user' AND s.grantee_id = ?)
             ${orgIds.length ? `OR (s.grantee_type = 'org' AND s.grantee_id IN (${placeholders(orgIds.length)}))` : ""}
             ${teamIds.length ? `OR (s.grantee_type = 'team' AND s.grantee_id IN (${placeholders(teamIds.length)}))` : ""} )
        ORDER BY p.ord ASC
      `;
      const rows = db.prepare(sql).all(userId, ...orgIds, ...teamIds) as {
        owner_id: string;
        project_id: string;
        role: string;
        grantee_type: string;
        grantee_id: string;
      }[];
      return rows.map((r) => ({
        ownerId: r.owner_id,
        projectId: r.project_id,
        role: r.role as ShareRole,
        granteeType: r.grantee_type as GranteeType,
        granteeId: r.grantee_id,
      }));
    },
  };
}
