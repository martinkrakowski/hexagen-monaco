import type Database from "better-sqlite3";

/**
 * The audit trail (D-A6): narrow, and APPEND-ONLY.
 *
 * Append-only is enforced by construction, NOT by the schema: SQLite would
 * happily accept `UPDATE audit_log` or `DELETE FROM audit_log`. What makes the
 * property true is that no such statement is prepared anywhere in the
 * codebase, and `AuditLogRepository` exposes nothing but `append`. A guard
 * test asserts that surface, because "we simply never wrote one" decays the
 * moment someone does.
 *
 * No reader is exported yet. P-A4 (share/revoke) writes rows here; a reader
 * arrives when a surface actually displays them, so this does not become a
 * store with no consumer in the meantime (the `scansFor` shape). Tests read
 * the table directly, which is deliberate — a reader added only to satisfy a
 * test is a reader with no product behind it.
 *
 * ASYNC BY DECISION (D-A9), as with `orgs-store` and `teams-store` — but see
 * `prepareAuditAppend` for the synchronous form the stores enlist in their own
 * transactions.
 */

/** v1 vocabulary (D-A6): org and team management, plus share grant/revoke from P-A4. */
export type AuditAction =
  | "org.create"
  | "org.delete"
  | "team.member.add"
  | "team.member.remove"
  | "team.create"
  | "team.delete"
  | "org.member.add"
  | "org.member.remove"
  // A role change is a distinct event, not an "add" with different arguments:
  // conflating them would make the trail unable to answer "when did this
  // person become an owner", which is the question an audit log is for.
  | "org.member.role_change"
  | "org.invite"
  | "org.invite.accept"
  | "share.grant"
  | "share.revoke";

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
  /**
   * How many rows match this action and subject.
   *
   * A COUNT, deliberately, not a listing: P-A4 owns the display reader, and a
   * store with no consumer is the `scansFor` shape this codebase already has
   * one of. It exists because an audit write that nothing can observe cannot
   * be tested — a membership test that asserts only membership passes with the
   * audit append deleted, which is the defect this answers. Reading does not
   * weaken append-only; there is still no update or delete.
   */
  countFor(action: AuditAction, subjectId: string): Promise<number>;
}

/**
 * The SYNCHRONOUS appender, for callers that must write the audit row inside
 * the same better-sqlite3 transaction as the mutation it records.
 *
 * A separate `await audit.append(...)` after an awaited mutation commits
 * independently: the mutation can succeed while the audit write throws,
 * leaving an unaudited change — which is precisely the event an audit log
 * exists to make impossible to miss. Enlisting both in one transaction means
 * a failed append rolls the mutation back.
 */
export function prepareAuditAppend(
  db: Database.Database,
): (entry: AuditEntry) => void {
  const insert = db.prepare(`
    INSERT INTO audit_log (
      id, actor_id, action, subject_owner_id, subject_id,
      grantee_type, grantee_id, created_at
    ) VALUES (
      @id, @actor_id, @action, @subject_owner_id, @subject_id,
      @grantee_type, @grantee_id, @created_at
    )
  `);
  return (entry) => {
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
  };
}

export function createAuditLogRepository(
  db: Database.Database,
): AuditLogRepository {
  const append = prepareAuditAppend(db);
  const count = db.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND subject_id = ?",
  );
  return {
    async append(entry) {
      append(entry);
    },
    async countFor(action, subjectId) {
      return (count.get(action, subjectId) as { n: number }).n;
    },
  };
}
