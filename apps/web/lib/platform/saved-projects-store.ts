import type { PlatformDb } from "./db";
import { revokeSharesForProject } from "./project-shares-store";
import type {
  PersistenceError,
  Result,
  SavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";

interface ProjectRow {
  id: string;
  name: string;
  payload: string;
  created_at: number;
  updated_at: number;
  ord: number;
  /** H1.4: monotonic revision. Rows written before H1.4 read as 1. */
  rev: number;
  /** H1.4: the user who last wrote. NULL means "before H1.4", not "nobody". */
  updated_by: string | null;
}

/**
 * H1.4 write precondition. A bare number is the LEGACY `updated_at` form and
 * is still accepted during the transition; `{ rev }` is canonical.
 */
export type ProjectPrecondition =
  | number
  | { rev: number }
  | { updatedAt: number };

/** What a write returns: the stored project and its NEW revision. */
export interface ProjectWriteResult {
  project: SavedProject;
  rev: number;
}

function preconditionParams(precondition: ProjectPrecondition | undefined): {
  expected_rev: number | null;
  expected_updated_at: number | null;
} {
  if (precondition === undefined) {
    return { expected_rev: null, expected_updated_at: null };
  }
  if (typeof precondition === "number") {
    return { expected_rev: null, expected_updated_at: precondition };
  }
  if ("rev" in precondition) {
    return { expected_rev: precondition.rev, expected_updated_at: null };
  }
  return { expected_rev: null, expected_updated_at: precondition.updatedAt };
}

function persistError(
  kind: PersistenceError["kind"],
  message: string,
  cause?: unknown,
): PersistenceError {
  if (kind === "SerializationFailed" || kind === "DeserializationFailed") {
    return { kind, message, cause };
  }
  if (kind === "Unknown") {
    return { kind, message, cause };
  }
  return { kind, message };
}

function parsePayload(row: ProjectRow): Result<SavedProject, PersistenceError> {
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        success: false,
        error: persistError(
          "DeserializationFailed",
          `Saved project ${row.id} payload is not an object`,
        ),
      };
    }
    return { success: true, value: parsed as SavedProject };
  } catch (cause) {
    return {
      success: false,
      error: persistError(
        "DeserializationFailed",
        `Failed to parse saved project ${row.id}`,
        cause,
      ),
    };
  }
}

export interface SavedProjectsStore extends SavedProjectsPersistencePort {
  /**
   * Replace one row. When `expectedUpdatedAt` is set, the write is rejected
   * with `Conflict` unless that value still matches the stored row (If-Match).
   */
  putProject(
    project: SavedProject,
    precondition?: ProjectPrecondition,
    actorUserId?: string,
  ): Promise<Result<ProjectWriteResult, PersistenceError>>;

  /**
   * One row by id, or `null` when this owner has no such project.
   *
   * H0.4 / P-A3: the `[projectId]` route used to call `loadProjects()` and
   * `.find()`, deserialising every project in the tenant to return one. The
   * keyed statement already existed here; only a public method was missing.
   * `null` is a normal answer, not an error — the route decides what a miss
   * means, and for a cross-tenant request that answer is 403, never 404.
   */
  getProject(
    id: string,
  ): Promise<Result<SavedProject | null, PersistenceError>>;

  /**
   * Same row as `getProject`, plus the monotonic `rev` used as the GET ETag.
   * The payload itself does not carry rev; the column is the source of truth.
   */
  getProjectWithRev(
    id: string,
  ): Promise<Result<ProjectWriteResult | null, PersistenceError>>;
}

export function createSavedProjectsStore(
  db: PlatformDb,
  ownerId: string,
): SavedProjectsStore {
  const selectAll =
    "SELECT id, name, payload, created_at, updated_at, ord, rev, updated_by FROM saved_projects WHERE owner_id = ? ORDER BY ord ASC";
  const selectOne =
    "SELECT id, name, payload, created_at, updated_at, ord, rev, updated_by FROM saved_projects WHERE owner_id = ? AND id = ?";
  const minOrd =
    "SELECT COALESCE(MIN(ord), 0) AS min_ord FROM saved_projects WHERE owner_id = ?";
  const insert = `
    INSERT INTO saved_projects (id, owner_id, name, payload, created_at, updated_at, ord)
    VALUES (@id, @owner_id, @name, @payload, hx_ts(@created_at), hx_ts(@updated_at), @ord)
  `;
  /**
   * Bulk replace used to DELETE + INSERT, which reset `rev` to the column
   * default of 1 (ABA: a stale `rev:1` If-Match became valid again). UPSERT
   * increments existing rows and inserts new ids at 1. `updated_by` is left
   * alone: this path has no actor.
   */
  const upsert = `
    INSERT INTO saved_projects (id, owner_id, name, payload, created_at, updated_at, ord)
    VALUES (@id, @owner_id, @name, @payload, hx_ts(@created_at), hx_ts(@updated_at), @ord)
    ON CONFLICT (owner_id, id) DO UPDATE SET
      name = excluded.name,
      payload = excluded.payload,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      ord = excluded.ord,
      rev = saved_projects.rev + 1
  `;
  /**
   * H1.4: the ONE update path. It always increments `rev` and stamps
   * `updated_by`, and both preconditions are optional columns of the same
   * WHERE clause rather than separate statements:
   *
   *   both NULL          -> unconditional write (no If-Match)
   *   @expected_rev      -> H1.4 canonical, monotonic
   *   @expected_updated_at -> legacy If-Match, the clock (see parseIfMatch)
   *
   * A second statement is how one of them ends up missing the rev bump; a
   * row whose rev did not move is a lost update that no precondition can
   * afterwards detect.
   */
  const updateProject = `
    UPDATE saved_projects
        SET name = @name,
            payload = @payload,
            updated_at = hx_ts(@updated_at),
            rev = rev + 1,
            updated_by = @updated_by
      WHERE owner_id = @owner_id
        AND id = @id
        AND (CAST(@expected_rev AS INTEGER) IS NULL OR rev = @expected_rev)
        AND (CAST(@expected_updated_at AS BIGINT) IS NULL OR updated_at = hx_ts(@expected_updated_at))
    RETURNING rev
  `;
  const remove = "DELETE FROM saved_projects WHERE owner_id = ? AND id = ?";
  const clear = "DELETE FROM saved_projects WHERE owner_id = ?";
  const selectIds = "SELECT id FROM saved_projects WHERE owner_id = ?";

  const removeWithShares = (id: string): Promise<void> =>
    db.transaction(async (tx) => {
      await revokeSharesForProject(tx, ownerId, id);
      await tx.run(remove, [ownerId, id]);
    });

  const replaceAll = (projects: SavedProject[]): Promise<void> =>
    db.transaction(async (tx) => {
      // Grants on projects that do NOT survive the replacement are revoked in
      // the same transaction; surviving ids keep their grants. Without this a
      // dropped project's live grants re-apply to any future project reusing
      // its id (ghost grants — review flag on #652).
      const surviving = new Set(projects.map((p) => p.id));
      const existing = await tx.all<{ id: string }>(selectIds, [ownerId]);
      for (const row of existing) {
        if (!surviving.has(row.id))
          await revokeSharesForProject(tx, ownerId, row.id);
      }
      // The same for ids that are NEW in this replacement: a project created
      // here starts with no grants, whatever was once granted on its id.
      const known = new Set(existing.map((row) => row.id));
      for (const project of projects) {
        if (!known.has(project.id))
          await revokeSharesForProject(tx, ownerId, project.id);
      }
      // Delete ONLY the non-surviving rows. A clear + reinsert would reset
      // `rev` to the column default on every surviving project, making a stale
      // If-Match token valid again (the ABA the H1.4 contract exists to stop);
      // survivors go through the UPSERT below, which increments their rev.
      const incomingIds = projects.map((p) => p.id);
      if (projects.length === 0) {
        await tx.run(clear, [ownerId]);
        return;
      }
      await tx.run(
        `DELETE FROM saved_projects
          WHERE owner_id = ? AND id NOT IN (${incomingIds.map(() => "?").join(",")})`,
        [ownerId, ...incomingIds],
      );
      for (let i = 0; i < projects.length; i += 1) {
        const project = projects[i];
        await tx.run(upsert, {
          id: project.id,
          owner_id: ownerId,
          name: project.name,
          payload: JSON.stringify(project),
          created_at: project.createdAt,
          updated_at: project.updatedAt,
          ord: i,
        });
      }
    });

  async function readProjectWithRev(
    id: string,
  ): Promise<Result<ProjectWriteResult | null, PersistenceError>> {
    try {
      const row = await db.get<ProjectRow>(selectOne, [ownerId, id]);
      if (!row) return { success: true, value: null };
      const parsed = parsePayload(row);
      if (!parsed.success) return parsed;
      return { success: true, value: { project: parsed.value, rev: row.rev } };
    } catch (cause) {
      return {
        success: false,
        error: persistError(
          "DeserializationFailed",
          `Failed to load saved project ${id}`,
          cause,
        ),
      };
    }
  }

  return {
    async getProject(id: string) {
      const found = await readProjectWithRev(id);
      if (!found.success) return found;
      return { success: true, value: found.value?.project ?? null };
    },

    async getProjectWithRev(id: string) {
      return readProjectWithRev(id);
    },

    async loadProjects() {
      try {
        const rows = await db.all<ProjectRow>(selectAll, [ownerId]);
        const projects: SavedProject[] = [];
        for (const row of rows) {
          const parsed = parsePayload(row);
          if (!parsed.success) return parsed;
          projects.push(parsed.value);
        }
        return { success: true, value: projects };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "DeserializationFailed",
            "Failed to load saved projects",
            cause,
          ),
        };
      }
    },

    async saveProjects(projects) {
      try {
        await replaceAll(projects);
        return { success: true, value: undefined };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to replace saved projects",
            cause,
          ),
        };
      }
    },

    async createProjectRecord(project) {
      try {
        // One transaction: the existence check, the position read and the
        // insert ran back to back on the synchronous driver, so nothing could
        // come between them. With awaits between them, two creates issued in
        // the same tick can interleave on this one-connection seam, and any
        // two requests can on a pooled backend; both would read the same
        // MIN(ord). The transaction serialises them here. A pooled backend
        // does not by itself, which is why the catch below still maps a
        // unique violation to Conflict.
        const conflict = await db.transaction(async (tx) => {
          const existing = await tx.get<ProjectRow>(selectOne, [
            ownerId,
            project.id,
          ]);
          if (existing) return true;
          // A new project starts with no grants. Any live grant already on
          // this id belongs to a project that is gone (ids are chosen by the
          // client and can come back); it must not attach to this one.
          await revokeSharesForProject(tx, ownerId, project.id);
          const { min_ord } = (await tx.get<{ min_ord: number }>(minOrd, [
            ownerId,
          ]))!;
          await tx.run(insert, {
            id: project.id,
            owner_id: ownerId,
            name: project.name,
            payload: JSON.stringify(project),
            created_at: project.createdAt,
            updated_at: project.updatedAt,
            ord: min_ord - 1,
          });
          return false;
        });
        if (conflict) {
          return {
            success: false,
            error: persistError(
              "Conflict",
              `A saved project with id ${project.id} already exists`,
            ),
          };
        }
        return { success: true, value: project };
      } catch (cause) {
        if (db.isUniqueViolation(cause)) {
          return {
            success: false,
            error: persistError(
              "Conflict",
              `A saved project with id ${project.id} already exists`,
            ),
          };
        }
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to create saved project",
            cause,
          ),
        };
      }
    },

    async updateProjectRecord(id, updater) {
      try {
        const row = await db.get<ProjectRow>(selectOne, [ownerId, id]);
        if (!row) {
          return {
            success: false,
            error: persistError("NotFound", `No saved project with id ${id}`),
          };
        }
        const parsed = parsePayload(row);
        if (!parsed.success) return parsed;
        const updated = updater(parsed.value);
        if (updated === parsed.value) {
          return { success: true, value: parsed.value };
        }
        const written = await db.get<{ rev: number }>(updateProject, {
          id,
          owner_id: ownerId,
          name: updated.name,
          payload: JSON.stringify(updated),
          updated_at: updated.updatedAt,
          // No actor on this path: updateProjectRecord is the in-process port
          // used by client contexts, not the HTTP write. The route stamps
          // updated_by; leaving it NULL here beats attributing the write to
          // whoever happens to own the store.
          updated_by: null,
          expected_rev: row.rev,
          expected_updated_at: null,
        });
        if (!written) {
          return {
            success: false,
            error: persistError("Conflict", "Project was updated elsewhere"),
          };
        }
        return { success: true, value: updated };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to update saved project",
            cause,
          ),
        };
      }
    },

    async deleteProjectRecord(id) {
      try {
        // One transaction: the row and its live grants go together, or
        // neither does. See revokeSharesForProject for why.
        await removeWithShares(id);
        return { success: true, value: undefined };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to delete saved project",
            cause,
          ),
        };
      }
    },

    async putProject(project, precondition, actorUserId) {
      try {
        const existing = await db.get<ProjectRow>(selectOne, [
          ownerId,
          project.id,
        ]);
        if (!existing) {
          return {
            success: false,
            error: persistError(
              "NotFound",
              `No saved project with id ${project.id}`,
            ),
          };
        }
        // The UPDATE returns the rev it wrote. The rev read above is only good
        // for telling NotFound from Conflict: two writers without a
        // precondition can both read the same rev, and each must be told the
        // rev its own write produced.
        const written = await db.get<{ rev: number }>(updateProject, {
          id: project.id,
          owner_id: ownerId,
          name: project.name,
          payload: JSON.stringify(project),
          updated_at: project.updatedAt,
          updated_by: actorUserId ?? null,
          ...preconditionParams(precondition),
        });
        if (!written) {
          // The row exists (checked above), so a zero-row write can only mean
          // the precondition did not match: a Conflict, never a NotFound.
          return {
            success: false,
            error: persistError(
              precondition === undefined ? "NotFound" : "Conflict",
              precondition === undefined
                ? `No saved project with id ${project.id}`
                : "Project was updated elsewhere",
            ),
          };
        }
        return {
          success: true,
          value: { project, rev: written.rev },
        };
      } catch (cause) {
        return {
          success: false,
          error: persistError(
            "SerializationFailed",
            "Failed to replace saved project",
            cause,
          ),
        };
      }
    },
  };
}
