import type { PlatformDb, PlatformDbSession } from "./db";
import type { PersistenceError, Result } from "@hexagen/shared";

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
  | PersistenceError
  | { kind: "InvalidInput"; message: string }
  | { kind: "UnknownProject"; message: string };

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
  ): Promise<Result<OwnerDocument, OwnerDocumentsError>>;
  delete(
    kind: DocumentKind,
    id: string,
  ): Promise<Result<{ deleted: boolean }, OwnerDocumentsError>>;
}

function persistError(
  kind: OwnerDocumentsError["kind"],
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

export function createOwnerDocumentsStore(
  db: PlatformDb,
  ownerId: string,
  userId: string,
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

    async put(input, expectedRev?) {
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
          return {
            success: false,
            error: persistError("Conflict", "document was updated elsewhere"),
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

    async delete(kind, id) {
      try {
        const result = await db.run(deleteDoc, [ownerId, userId, kind, id]);
        return { success: true, value: { deleted: result.changes > 0 } };
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
