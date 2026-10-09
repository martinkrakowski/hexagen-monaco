import type { PlatformDb, PlatformDbSession } from "./db";

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
 * ASYNC BY DECISION (D-A9), as with `orgs-store` and `teams-store`.
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
  | "share.revoke"
  | "document.precondition_failed";

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  /** The tenant the subject belongs to — an org id here, a project owner in P-A4. */
  subjectOwnerId?: string | null;
  /** The team id here; the project id in P-A4. */
  subjectId?: string | null;
  granteeType?: string | null;
  granteeId?: string | null;
  /**
   * Structured what-was-refused, JSON-encoded by appendAudit. Present
   * only on rows a store writes for a refused precondition; NULL on every row
   * written before this column existed and on every non-refusal row.
   */
  detail?: Record<string, unknown>;
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

const INSERT_AUDIT = `
    INSERT INTO audit_log (
      id, actor_id, action, subject_owner_id, subject_id,
      grantee_type, grantee_id, created_at, detail
    ) VALUES (
      @id, @actor_id, @action, @subject_owner_id, @subject_id,
      @grantee_type, @grantee_id, @created_at, @detail
    )
  `;

/**
 * Writes one audit row on the caller's session. A store that records a
 * mutation calls this with its transaction's `tx`, so the row commits with the
 * mutation or not at all: a separate append after the mutation commits
 * independently, and an unaudited change is precisely the event an audit log
 * exists to make impossible to miss.
 */
export async function appendAudit(
  session: PlatformDbSession,
  entry: AuditEntry,
): Promise<void> {
  await session.run(INSERT_AUDIT, {
    id: crypto.randomUUID(),
    actor_id: entry.actorId,
    action: entry.action,
    subject_owner_id: entry.subjectOwnerId ?? null,
    subject_id: entry.subjectId ?? null,
    grantee_type: entry.granteeType ?? null,
    grantee_id: entry.granteeId ?? null,
    created_at: new Date().toISOString(),
    detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
  });
}

export function createAuditLogRepository(db: PlatformDb): AuditLogRepository {
  return {
    async append(entry) {
      await appendAudit(db, entry);
    },
    async countFor(action, subjectId) {
      const row = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND subject_id = ?",
        [action, subjectId],
      );
      return row ? row.n : 0;
    },
  };
}
