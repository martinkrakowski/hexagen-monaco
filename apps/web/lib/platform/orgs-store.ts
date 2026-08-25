import type Database from "better-sqlite3";

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

export interface Org {
  id: string;
  slug: string;
  name: string;
  createdBy: string;
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
  addMember(orgId: string, userId: string, role: OrgRole): Promise<void>;
  removeMember(orgId: string, userId: string): Promise<void>;
  /** The membership decision `requireTenant` asks on every request. */
  memberRole(orgId: string, userId: string): Promise<OrgRole | null>;
  listOrgIdsForUser(userId: string): Promise<string[]>;
}

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  created_by: string;
  created_at: string;
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

export function createOrgsRepository(db: Database.Database): OrgsRepository {
  const insertOrg = db.prepare(`
    INSERT INTO orgs (id, slug, name, created_by, created_at)
    VALUES (@id, @slug, @name, @created_by, @created_at)
  `);
  const selectOrg = db.prepare("SELECT * FROM orgs WHERE id = ?");
  const selectOrgBySlug = db.prepare("SELECT * FROM orgs WHERE slug = ?");
  const upsertMember = db.prepare(`
    INSERT INTO org_members (org_id, user_id, role, created_at)
    VALUES (@org_id, @user_id, @role, @created_at)
    ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role
  `);
  const deleteMember = db.prepare(
    "DELETE FROM org_members WHERE org_id = ? AND user_id = ?",
  );
  const selectRole = db.prepare(
    "SELECT role FROM org_members WHERE org_id = ? AND user_id = ?",
  );
  const selectOrgIds = db.prepare(
    "SELECT org_id FROM org_members WHERE user_id = ? ORDER BY org_id",
  );

  return {
    async createOrg(input) {
      const org: OrgRow = {
        id: input.id ?? crypto.randomUUID(),
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
    async addMember(orgId, userId, role) {
      upsertMember.run({
        org_id: orgId,
        user_id: userId,
        role,
        created_at: new Date().toISOString(),
      });
    },
    async removeMember(orgId, userId) {
      deleteMember.run(orgId, userId);
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
  };
}
