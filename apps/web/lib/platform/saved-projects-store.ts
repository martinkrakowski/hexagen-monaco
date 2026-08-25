import { prepareShareRevokeAllForProject } from "./project-shares-store";
import type Database from "better-sqlite3";
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
  ): Result<ProjectWriteResult, PersistenceError>;

  /**
   * One row by id, or `null` when this owner has no such project.
   *
   * H0.4 / P-A3: the `[projectId]` route used to call `loadProjects()` and
   * `.find()`, deserialising every project in the tenant to return one. The
   * keyed statement already existed here; only a public method was missing.
   * `null` is a normal answer, not an error — the route decides what a miss
   * means, and for a cross-tenant request that answer is 403, never 404.
   */
  getProject(id: string): Result<SavedProject | null, PersistenceError>;

  /**
   * Same row as `getProject`, plus the monotonic `rev` used as the GET ETag.
   * The payload itself does not carry rev; the column is the source of truth.
   */
  getProjectWithRev(
    id: string,
  ): Result<ProjectWriteResult | null, PersistenceError>;
}

export function createSavedProjectsStore(
  db: Database.Database,
  ownerId: string,
): SavedProjectsStore {
  const selectAll = db.prepare(
    "SELECT id, name, payload, created_at, updated_at, ord, rev, updated_by FROM saved_projects WHERE owner_id = ? ORDER BY ord ASC",
  );
  const selectOne = db.prepare(
    "SELECT id, name, payload, created_at, updated_at, ord, rev, updated_by FROM saved_projects WHERE owner_id = ? AND id = ?",
  );
  const minOrd = db.prepare(
    "SELECT COALESCE(MIN(ord), 0) AS min_ord FROM saved_projects WHERE owner_id = ?",
  );
  const insert = db.prepare(`
    INSERT INTO saved_projects (id, owner_id, name, payload, created_at, updated_at, ord)
    VALUES (@id, @owner_id, @name, @payload, @created_at, @updated_at, @ord)
  `);
  /**
   * Bulk replace used to DELETE + INSERT, which reset `rev` to the column
   * default of 1 (ABA: a stale `rev:1` If-Match became valid again). UPSERT
   * increments existing rows and inserts new ids at 1. `updated_by` is left
   * alone: this path has no actor.
   */
  const upsert = db.prepare(`
    INSERT INTO saved_projects (id, owner_id, name, payload, created_at, updated_at, ord)
    VALUES (@id, @owner_id, @name, @payload, @created_at, @updated_at, @ord)
    ON CONFLICT (owner_id, id) DO UPDATE SET
      name = excluded.name,
      payload = excluded.payload,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      ord = excluded.ord,
      rev = saved_projects.rev + 1
  `);
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
  const updateProject = db.prepare(`
    UPDATE saved_projects
       SET name = @name,
           payload = @payload,
           updated_at = @updated_at,
           rev = rev + 1,
           updated_by = @updated_by
     WHERE owner_id = @owner_id
       AND id = @id
       AND (@expected_rev IS NULL OR rev = @expected_rev)
       AND (@expected_updated_at IS NULL OR updated_at = @expected_updated_at)
  `);
  const remove = db.prepare(
    "DELETE FROM saved_projects WHERE owner_id = ? AND id = ?",
  );
  const clear = db.prepare("DELETE FROM saved_projects WHERE owner_id = ?");

  const revokeSharesFor = prepareShareRevokeAllForProject(db);
  const selectIds = db.prepare(
    "SELECT id FROM saved_projects WHERE owner_id = ?",
  );

  const removeWithShares = db.transaction((id: string) => {
    revokeSharesFor(ownerId, id);
    remove.run(ownerId, id);
  });

  const replaceAll = db.transaction((projects: SavedProject[]) => {
    // Grants on projects that do NOT survive the replacement are revoked in
    // the same transaction; surviving ids keep their grants. Without this a
    // dropped project's live grants re-apply to any future project reusing
    // its id (ghost grants — review flag on #652).
    const surviving = new Set(projects.map((p) => p.id));
    const existing = selectIds.all(ownerId) as { id: string }[];
    for (const row of existing) {
      if (!surviving.has(row.id)) revokeSharesFor(ownerId, row.id);
    }
    // Delete ONLY the non-surviving rows. A clear + reinsert would reset
    // `rev` to the column default on every surviving project, making a stale
    // If-Match token valid again (the ABA the H1.4 contract exists to stop);
    // survivors go through the UPSERT below, which increments their rev.
    const incomingIds = projects.map((p) => p.id);
    if (projects.length === 0) {
      clear.run(ownerId);
      return;
    }
    db.prepare(
      `DELETE FROM saved_projects
        WHERE owner_id = ? AND id NOT IN (${incomingIds.map(() => "?").join(",")})`,
    ).run(ownerId, ...incomingIds);
    for (let i = 0; i < projects.length; i += 1) {
      const project = projects[i];
      upsert.run({
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

  function readProjectWithRev(
    id: string,
  ): Result<ProjectWriteResult | null, PersistenceError> {
    try {
      const row = selectOne.get(ownerId, id) as ProjectRow | undefined;
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
    getProject(id: string) {
      const found = readProjectWithRev(id);
      if (!found.success) return found;
      return { success: true, value: found.value?.project ?? null };
    },

    getProjectWithRev(id: string) {
      return readProjectWithRev(id);
    },

    async loadProjects() {
      try {
        const rows = selectAll.all(ownerId) as ProjectRow[];
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
        replaceAll(projects);
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
        const existing = selectOne.get(ownerId, project.id) as
          | ProjectRow
          | undefined;
        if (existing) {
          return {
            success: false,
            error: persistError(
              "Conflict",
              `A saved project with id ${project.id} already exists`,
            ),
          };
        }
        const { min_ord } = minOrd.get(ownerId) as { min_ord: number };
        insert.run({
          id: project.id,
          owner_id: ownerId,
          name: project.name,
          payload: JSON.stringify(project),
          created_at: project.createdAt,
          updated_at: project.updatedAt,
          ord: min_ord - 1,
        });
        return { success: true, value: project };
      } catch (cause) {
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
        const row = selectOne.get(ownerId, id) as ProjectRow | undefined;
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
        const written = updateProject.run({
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
        if (written.changes === 0) {
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
        // neither does. See prepareShareRevokeAllForProject for why.
        removeWithShares(id);
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

    putProject(project, precondition, actorUserId) {
      try {
        const existing = selectOne.get(ownerId, project.id) as
          | ProjectRow
          | undefined;
        if (!existing) {
          return {
            success: false,
            error: persistError(
              "NotFound",
              `No saved project with id ${project.id}`,
            ),
          };
        }
        const written = updateProject.run({
          id: project.id,
          owner_id: ownerId,
          name: project.name,
          payload: JSON.stringify(project),
          updated_at: project.updatedAt,
          updated_by: actorUserId ?? null,
          ...preconditionParams(precondition),
        });
        if (written.changes === 0) {
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
          value: { project, rev: existing.rev + 1 },
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
