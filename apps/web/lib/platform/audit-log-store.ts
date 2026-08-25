import type Database from "better-sqlite3";

/**
 * The audit trail (D-A6): narrow, and APPEND-ONLY.
 *
 * Only `append` exists. No UPDATE or DELETE statement is prepared against
 * `audit_log` anywhere in the codebase — an audit trail that can be rewritten
 * is not one, and the absence of the statement is the enforcement.
 *
 * No reader is exported yet. P-A4 adds share/revoke rows; a reader arrives
 * when a surface actually displays them, so this does not become a store with
 * no consumer in the meantime (the `scansFor` shape).
 *
 * ASYNC BY DECISION (D-A9), as with `orgs-store` and `teams-store`.
 */

/** v1 vocabulary. `share.*` rows arrive in P-A4. */
export type AuditAction =
  | "team.member.add"
  | "team.member.remove"
  | "team.create"
  | "team.delete";

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  /** The tenant the subject belongs to — an org id here, a project owner in P-A4. */
  subjectOwnerId?: string | null;
  /** The team id here; the project id in P-A4. */
  subjectId?: string | null;
  granteeType?: string | null;
  granteeId?: string | null;
}

export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
}

export function createAuditLogRepository(
  db: Database.Database,
): AuditLogRepository {
  const insert = db.prepare(`
    INSERT INTO audit_log (
      id, actor_id, action, subject_owner_id, subject_id,
      grantee_type, grantee_id, created_at
    ) VALUES (
      @id, @actor_id, @action, @subject_owner_id, @subject_id,
      @grantee_type, @grantee_id, @created_at
    )
  `);

  return {
    async append(entry) {
      insert.run({
        id: crypto.randomUUID(),
        actor_id: entry.actorId,
        action: entry.action,
        subject_owner_id: entry.subjectOwnerId ?? null,
        subject_id: entry.subjectId ?? null,
        grantee_type: entry.granteeType ?? null,
        grantee_id: entry.granteeId ?? null,
        created_at: new Date().toISOString(),
      });
    },
  };
}
