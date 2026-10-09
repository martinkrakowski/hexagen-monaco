import type { PlatformDb, PlatformDbSession } from "./db";
import type { PersistenceError, Result } from "@hexagen/shared";
import { appendAudit } from "./audit-log-store";

export const DOCUMENT_KINDS = [
  "workspace",
  "governance",
  "brownfield-draft",
  "canvas-layout",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Letters, digits, dot, underscore, colon, hyphen; 1 to 128 characters. This
 * is a wire contract: a caller whose natural key has other characters (a
 * user-typed name, for example) hashes or encodes it first.
 */
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
/** Upper bound on the JSON text of one payload, in UTF-16 code units. */
export const DOCUMENT_MAX_PAYLOAD_LENGTH = 2_000_000;

export interface OwnerDocument {
  kind: DocumentKind;
  id: string;
  projectId: string | null;
  rev: number;
  payload: unknown; // parsed JSON
  updatedAt: number; // epoch ms
}
export type OwnerDocumentSummary = Omit<OwnerDocument, "payload">;

export type OwnerDocumentsError =
  | Exclude<PersistenceError, { kind: "Conflict" }>
  | { kind: "InvalidInput"; message: string }
  | { kind: "UnknownProject"; message: string }
  | { kind: "NotAMember"; message: string }
  | {
      kind: "Conflict";
      message: string;
      currentRev?: number;
      audited?: boolean;
    }
  | {
      kind: "PreconditionFailed";
      message: string;
      currentRev: number;
      audited?: boolean;
    };

export interface OwnerDocumentsStore {
  list(filter?: {
    kind?: DocumentKind;
    projectId?: string;
  }): Promise<Result<OwnerDocumentSummary[], OwnerDocumentsError>>;
  get(
    kind: DocumentKind,
    id: string,
  ): Promise<Result<OwnerDocument | null, OwnerDocumentsError>>;
  put(
    input: {
      kind: DocumentKind;
      id: string;
      projectId?: string | null;
      payload: unknown;
    },
    expectedRev?: number,
    options?: { createOnly?: boolean },
  ): Promise<Result<OwnerDocument, OwnerDocumentsError>>;
  delete(
    kind: DocumentKind,
    id: string,
    expectedRev?: number,
  ): Promise<Result<{ deleted: boolean }, OwnerDocumentsError>>;
}

function persistError(
  kind: Exclude<OwnerDocumentsError["kind"], "PreconditionFailed">,
  message: string,
  cause?: unknown,
): OwnerDocumentsError {
  if (kind === "SerializationFailed" || kind === "DeserializationFailed") {
    return { kind, message, cause };
  }
  if (kind === "Unknown") {
    return { kind, message, cause };
  }
  return { kind, message };
}

function isDocumentKind(value: unknown): value is DocumentKind {
  return DOCUMENT_KINDS.some((k) => k === value);
}

function validatePutInput(
  kind: unknown,
  id: unknown,
  projectId: unknown,
  payload: unknown,
): { error: OwnerDocumentsError } | { payloadJson: string } {
  if (!isDocumentKind(kind)) {
    return {
      error: persistError(
        "InvalidInput",
        `invalid document kind: ${String(kind)}`,
      ),
    };
  }
  if (typeof id !== "string" || !DOCUMENT_ID_PATTERN.test(id)) {
    return {
      error: persistError("InvalidInput", `invalid document id: ${String(id)}`),
    };
  }
  if (typeof projectId === "string" && !DOCUMENT_ID_PATTERN.test(projectId)) {
    return {
      error: persistError("InvalidInput", `invalid projectId: ${projectId}`),
    };
  }
  if (payload === undefined) {
    return {
      error: persistError("InvalidInput", "payload is required"),
    };
  }
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(payload);
  } catch (cause) {
    return {
      error: persistError("InvalidInput", "payload is not serializable", cause),
    };
  }
  if (typeof payloadJson !== "string") {
    return {
      error: persistError("InvalidInput", "payload is not serializable"),
    };
  }
  if (payloadJson.length > DOCUMENT_MAX_PAYLOAD_LENGTH) {
    return {
      error: persistError(
        "InvalidInput",
        `payload exceeds ${DOCUMENT_MAX_PAYLOAD_LENGTH} characters`,
      ),
    };
  }
  return { payloadJson };
}

export function deleteDocumentsOfMember(
  session: PlatformDbSession,
  ownerId: string,
  userId: string,
): Promise<number> {
  return session
    .run("DELETE FROM owner_documents WHERE owner_id = ? AND user_id = ?", [
      ownerId,
      userId,
    ])
    .then((result) => result.changes);
}

export function deleteDocumentsOfOwner(
  session: PlatformDbSession,
  ownerId: string,
): Promise<number> {
  return session
    .run("DELETE FROM owner_documents WHERE owner_id = ?", [ownerId])
    .then((result) => result.changes);
}

export interface AuthoredDocument extends OwnerDocument {
  ownerId: string;
  /**
   * Set only when the stored `payload` failed to parse; `payload` is then
   * `null`. A stored JSON `null` parses fine and leaves this absent, so a
   * genuine null payload is never confused with a broken document.
   */
  payloadUnparseable?: boolean;
}

/** Why `listDocumentsAuthoredBy` stopped before all authored documents. */
export type TruncationReason = "rows" | "size";

export interface ListDocumentsResult {
  items: AuthoredDocument[];
  /** `null` when the account's documents fit within both budgets. */
  truncatedBy: TruncationReason | null;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative integer, got ${String(value)}`,
    );
  }
}

/**
 * First pass: keys + payload length only, no `payload` text. The size budget is
 * decided before any payload is materialised, so an oversized author cannot make
 * this read allocate a multi-megabyte payload it will then throw away.
 * `user_id` scopes every statement (DB-9: an account export is the author's
 * alone). Fetches `limit + 1`: the trailing row is the truncation probe and is
 * dropped before it is returned (LIMIT cannot tell "exactly N stored" from
 * "more than N stored" when the row count equals the limit).
 */
const SELECT_AUTHORED_DOCUMENTS = `
  SELECT owner_id, kind, id, project_id, rev, length(payload) AS payload_len, updated_at
    FROM owner_documents
   WHERE user_id = ?
   ORDER BY owner_id, kind, id
   LIMIT ?
`;

/**
 * Second pass: the full `payload` for one kept row, fetched by its full key.
 * `user_id` is re-checked here too, so no statement ever reads another author's
 * row. One statement per row keeps peak memory to a single payload.
 */
const SELECT_AUTHORED_DOCUMENT_PAYLOAD = `
  SELECT owner_id, kind, id, project_id, rev, payload, updated_at
    FROM owner_documents
   WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?
`;

/**
 * Every document one person authored, across tenants. For that person's own
 * export only — the caller is the author, scoped by `user_id` (the JWT `sub`),
 * never by the request.
 *
 * Two independent budgets bound the result: `limit` rows and `maxChars` of
 * payload text. `limit` is the real ceiling — this asks the database for
 * `limit + 1` rows and reports `truncatedBy: "rows"` when the trailing probe
 * row was there. The size budget walks the surviving rows in order and stops
 * before the row that would push the running length past `maxChars`, reporting
 * `truncatedBy: "size"`.
 *
 * Rows are scanned before the cut, but payloads are fetched only for the KEPT
 * rows (one statement per row by its full key), so a size-capped export never
 * allocates a payload it will discard. `user_id` appears in every statement.
 *
 * A row whose `payload` does not parse is kept rather than dropped: its
 * `payload` stays `null` and `payloadUnparseable` is set, so a broken document
 * is visible to the reader instead of silently absent.
 */
export async function listDocumentsAuthoredBy(
  session: PlatformDbSession,
  userId: string,
  limit: number,
  maxChars: number,
): Promise<ListDocumentsResult> {
  assertNonNegativeInteger("limit", limit);
  assertNonNegativeInteger("maxChars", maxChars);

  const keys = await session.all<{
    owner_id: string;
    kind: string;
    id: string;
    project_id: string | null;
    rev: number;
    payload_len: number;
    updated_at: number;
  }>(SELECT_AUTHORED_DOCUMENTS, [userId, limit + 1]);

  const rowsTruncated = keys.length > limit;
  const candidates = rowsTruncated ? keys.slice(0, limit) : keys;

  const kept: typeof candidates = [];
  let running = 0;
  let sizeTruncated = false;
  for (const c of candidates) {
    if (running + c.payload_len > maxChars) {
      sizeTruncated = true;
      break;
    }
    running += c.payload_len;
    kept.push(c);
  }

  // When both ceilings were passed, the size cut is the one that decided what
  // was kept (it fell inside the first `limit` rows), so it is the one reported.
  const truncatedBy: TruncationReason | null = sizeTruncated
    ? "size"
    : rowsTruncated
      ? "rows"
      : null;

  const items: AuthoredDocument[] = [];
  for (const c of kept) {
    const row = await session.get<{
      owner_id: string;
      kind: string;
      id: string;
      project_id: string | null;
      rev: number;
      payload: string;
      updated_at: number;
    }>(SELECT_AUTHORED_DOCUMENT_PAYLOAD, [c.owner_id, userId, c.kind, c.id]);
    if (!row) continue; // vanished between the scan and the fetch
    let payload: unknown = null;
    let payloadUnparseable = false;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      // Kept with payload null and flagged, so the reader can tell a broken
      // document apart from a genuine JSON `null` (see JSDoc).
      payloadUnparseable = true;
    }
    items.push({
      ownerId: row.owner_id,
      kind: row.kind as DocumentKind,
      id: row.id,
      projectId: row.project_id,
      rev: row.rev,
      payload,
      updatedAt: row.updated_at,
      ...(payloadUnparseable ? { payloadUnparseable: true } : {}),
    });
  }

  return { items, truncatedBy };
}

export function createOwnerDocumentsStore(
  db: PlatformDb,
  ownerId: string,
  userId: string,
  now: () => number = Date.now,
): OwnerDocumentsStore {
  const selectList = `
    SELECT kind, id, project_id, rev, updated_at
      FROM owner_documents
     WHERE owner_id = ? AND user_id = ?
       AND (? IS NULL OR kind = ?)
       AND (? IS NULL OR project_id = ?)
     ORDER BY updated_at DESC, kind, id
  `;
  const selectOne = `
    SELECT kind, id, project_id, rev, payload, updated_at
      FROM owner_documents
     WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?
  `;
  const deleteDoc = `
    DELETE FROM owner_documents
     WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?
  `;
  const membershipCheck =
    "SELECT 1 AS ok FROM org_members WHERE org_id = ? AND user_id = ?";
  const projectExists = `
    SELECT 1 AS ok FROM saved_projects
     WHERE owner_id = ? AND id = ?
  `;
  const upsert = `
    INSERT INTO owner_documents
      (owner_id, user_id, kind, id, project_id, rev, payload, updated_at, updated_by)
    VALUES (@owner_id, @user_id, @kind, @id, @project_id, 1, @payload, @updated_at, @updated_by)
    ON CONFLICT (owner_id, user_id, kind, id) DO UPDATE SET
      rev = owner_documents.rev + 1,
      payload = excluded.payload,
      project_id = excluded.project_id,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
    RETURNING rev, updated_at
  `;
  const updateWithRev = `
    UPDATE owner_documents
       SET rev = rev + 1, payload = @payload, project_id = @project_id,
           updated_at = @updated_at, updated_by = @updated_by
     WHERE owner_id = @owner_id AND user_id = @user_id AND kind = @kind AND id = @id
       AND rev = @expected_rev
    RETURNING rev, updated_at
  `;
  const selectKey = `
     SELECT rev FROM owner_documents
      WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?
   `;
  const insertOnly = `
     INSERT INTO owner_documents
       (owner_id, user_id, kind, id, project_id, rev, payload, updated_at, updated_by)
     VALUES (@owner_id, @user_id, @kind, @id, @project_id, 1, @payload, @updated_at, @updated_by)
     ON CONFLICT (owner_id, user_id, kind, id) DO NOTHING
     RETURNING rev, updated_at
   `;
  const deleteAtRev = `
      DELETE FROM owner_documents
       WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ? AND rev = ?
   `;
  const refusalRecent = `
    SELECT 1 FROM audit_log
     WHERE action = ?
       AND actor_id = ?
       AND subject_owner_id = ?
       AND subject_id = ?
       AND created_at > ?
     LIMIT 1
  `;

  /**
   * Records a precondition-failure audit row, capped at one per
   * (actor, document) per minute. Returns true when a row was written and
   * false when the cap suppressed it. The refusal result is unchanged either
   * way — the cap only bounds audit volume, not the error returned to the
   * caller.
   */
  async function recordRefusal(
    tx: PlatformDbSession,
    kind: DocumentKind,
    id: string,
  ): Promise<boolean> {
    const since = new Date(now() - 60_000).toISOString();
    const subjectId = `${kind}/${id}`;
    const exists = await tx.get<{ n: number } | undefined>(refusalRecent, [
      "document.precondition_failed",
      userId,
      ownerId,
      subjectId,
      since,
    ]);
    if (exists) return false;
    await appendAudit(tx, {
      actorId: userId,
      action: "document.precondition_failed",
      subjectOwnerId: ownerId,
      subjectId,
    });
    return true;
  }

  return {
    async list(filter) {
      try {
        const kind = filter?.kind ?? null;
        const projectId = filter?.projectId ?? null;
        const rows = await db.all<{
          kind: string;
          id: string;
          project_id: string | null;
          rev: number;
          updated_at: number;
        }>(selectList, [ownerId, userId, kind, kind, projectId, projectId]);
        return {
          success: true,
          value: rows.map((r) => ({
            kind: r.kind as DocumentKind,
            id: r.id,
            projectId: r.project_id,
            rev: r.rev,
            updatedAt: r.updated_at,
          })),
        };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to list documents",
            cause,
          ),
        };
      }
    },

    async get(kind, id) {
      try {
        const row = await db.get<{
          kind: string;
          id: string;
          project_id: string | null;
          rev: number;
          payload: string;
          updated_at: number;
        }>(selectOne, [ownerId, userId, kind, id]);
        if (!row) return { success: true, value: null };
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.payload);
        } catch (cause) {
          return {
            success: false,
            error: persistError(
              "DeserializationFailed",
              `Failed to parse document ${kind}/${id}`,
              cause,
            ),
          };
        }
        return {
          success: true,
          value: {
            kind: row.kind as DocumentKind,
            id: row.id,
            projectId: row.project_id,
            rev: row.rev,
            payload: parsed,
            updatedAt: row.updated_at,
          },
        };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to load document",
            cause,
          ),
        };
      }
    },

    async put(input, expectedRev?, options?) {
      const createOnly = options?.createOnly ?? false;
      if (createOnly && expectedRev !== undefined) {
        return {
          success: false,
          error: persistError(
            "InvalidInput",
            "createOnly cannot be combined with expectedRev",
          ),
        };
      }
      const kind = input.kind;
      const id = input.id;
      const projectId = input.projectId === undefined ? null : input.projectId;
      const validation = validatePutInput(kind, id, projectId, input.payload);
      if ("error" in validation)
        return { success: false, error: validation.error };

      const payloadJson = validation.payloadJson;

      try {
        return await db.transaction(async (tx) => {
          // Read inside the transaction: a put that waited in the queue is
          // stamped when it writes, so `updated_at` orders writes as they
          // landed.
          const now = Date.now();
          if (ownerId !== userId) {
            const member = await tx.get<{ ok: number }>(membershipCheck, [
              ownerId,
              userId,
            ]);
            if (!member) {
              return {
                success: false,
                error: persistError(
                  "NotAMember",
                  "author is not a member of this tenant",
                ),
              };
            }
          }
          if (typeof input.projectId === "string") {
            const exists = await tx.get<{ ok: number }>(projectExists, [
              ownerId,
              input.projectId,
            ]);
            if (!exists) {
              return {
                success: false,
                error: persistError(
                  "UnknownProject",
                  `project ${input.projectId} not found in tenant ${ownerId}`,
                ),
              };
            }
          }

          const params = {
            owner_id: ownerId,
            user_id: userId,
            kind,
            id,
            project_id: projectId,
            payload: payloadJson,
            updated_at: now,
            updated_by: userId,
          };

          if (createOnly) {
            const written = await tx.get<{
              rev: number;
              updated_at: number;
            }>(insertOnly, params);
            if (written) {
              return {
                success: true,
                value: {
                  kind,
                  id,
                  projectId,
                  rev: written.rev,
                  payload: input.payload,
                  updatedAt: written.updated_at,
                },
              };
            }
            // Row already exists (or vanished between the two statements).
            const existing = await tx.get<{ rev: number }>(selectKey, [
              ownerId,
              userId,
              kind,
              id,
            ]);
            if (!existing) {
              // The insert saw a conflicting row that this transaction's
              // snapshot cannot see; not reachable on SQLite; on Postgres under
              // SERIALIZABLE the seam retries a serialization failure before
              // this could be observed; pinned by the Postgres store tests (B2b-2).
              const audited = await recordRefusal(tx, kind, id);
              return {
                success: false,
                error: {
                  kind: "Conflict",
                  message: "document write conflicted",
                  audited,
                },
              };
            }
            const audited = await recordRefusal(tx, kind, id);
            return {
              success: false,
              error: {
                kind: "PreconditionFailed",
                message: "document already exists",
                currentRev: existing.rev,
                audited,
              },
            };
          }

          if (expectedRev === undefined) {
            const written = await tx.get<{
              rev: number;
              updated_at: number;
            }>(upsert, params);
            if (!written) {
              return {
                success: false,
                error: persistError(
                  "SerializationFailed",
                  "upsert returned no rows",
                ),
              };
            }
            return {
              success: true,
              value: {
                kind,
                id,
                projectId,
                rev: written.rev,
                payload: input.payload,
                updatedAt: written.updated_at,
              },
            };
          }

          const written = await tx.get<{
            rev: number;
            updated_at: number;
          }>(updateWithRev, {
            ...params,
            expected_rev: expectedRev,
          });
          if (written) {
            return {
              success: true,
              value: {
                kind,
                id,
                projectId,
                rev: written.rev,
                payload: input.payload,
                updatedAt: written.updated_at,
              },
            };
          }
          // No row matched the rev: distinguish NotFound from Conflict.
          const existing = await tx.get<{ rev: number }>(selectKey, [
            ownerId,
            userId,
            kind,
            id,
          ]);
          if (!existing) {
            return {
              success: false,
              error: persistError(
                "NotFound",
                `no document ${kind}/${id} for owner ${ownerId}`,
              ),
            };
          }
          const audited = await recordRefusal(tx, kind, id);
          return {
            success: false,
            error: {
              kind: "Conflict",
              message: "document was updated elsewhere",
              currentRev: existing.rev,
              audited,
            },
          };
        });
      } catch (cause) {
        if (db.isUniqueViolation(cause)) {
          return {
            success: false,
            error: persistError(
              "Conflict",
              `document ${kind}/${id} write conflicted`,
              cause,
            ),
          };
        }
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "failed to write document",
            cause,
          ),
        };
      }
    },

    async delete(kind, id, expectedRev?) {
      try {
        if (expectedRev === undefined) {
          const result = await db.run(deleteDoc, [ownerId, userId, kind, id]);
          return { success: true, value: { deleted: result.changes > 0 } };
        }
        return await db.transaction(async (tx) => {
          const result = await tx.run(deleteAtRev, [
            ownerId,
            userId,
            kind,
            id,
            expectedRev,
          ]);
          if (result.changes > 0) {
            return { success: true, value: { deleted: true } };
          }
          const existing = await tx.get<{ rev: number }>(selectKey, [
            ownerId,
            userId,
            kind,
            id,
          ]);
          if (!existing) {
            return {
              success: false,
              error: persistError(
                "NotFound",
                `no document ${kind}/${id} for owner ${ownerId}`,
              ),
            };
          }
          const audited = await recordRefusal(tx, kind, id);
          return {
            success: false,
            error: {
              kind: "PreconditionFailed",
              message: "document was updated elsewhere",
              currentRev: existing.rev,
              audited,
            },
          };
        });
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to delete document",
            cause,
          ),
        };
      }
    },
  };
}
