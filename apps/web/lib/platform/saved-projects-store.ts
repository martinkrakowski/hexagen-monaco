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
    expectedUpdatedAt?: number,
  ): Result<SavedProject, PersistenceError>;

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
}

export function createSavedProjectsStore(
  db: Database.Database,
  ownerId: string,
): SavedProjectsStore {
  const selectAll = db.prepare(
    "SELECT id, name, payload, created_at, updated_at, ord FROM saved_projects WHERE owner_id = ? ORDER BY ord ASC",
  );
  const selectOne = db.prepare(
    "SELECT id, name, payload, created_at, updated_at, ord FROM saved_projects WHERE owner_id = ? AND id = ?",
  );
  const minOrd = db.prepare(
    "SELECT COALESCE(MIN(ord), 0) AS min_ord FROM saved_projects WHERE owner_id = ?",
  );
  const insert = db.prepare(`
    INSERT INTO saved_projects (id, owner_id, name, payload, created_at, updated_at, ord)
    VALUES (@id, @owner_id, @name, @payload, @created_at, @updated_at, @ord)
  `);
  const update = db.prepare(`
    UPDATE saved_projects
       SET name = @name, payload = @payload, updated_at = @updated_at
     WHERE owner_id = @owner_id AND id = @id
  `);
  const updateIfMatch = db.prepare(`
    UPDATE saved_projects
       SET name = @name, payload = @payload, updated_at = @updated_at
     WHERE owner_id = @owner_id AND id = @id AND updated_at = @expected_updated_at
  `);
  const remove = db.prepare(
    "DELETE FROM saved_projects WHERE owner_id = ? AND id = ?",
  );
  const clear = db.prepare("DELETE FROM saved_projects WHERE owner_id = ?");

  const replaceAll = db.transaction((projects: SavedProject[]) => {
    clear.run(ownerId);
    for (let i = 0; i < projects.length; i += 1) {
      const project = projects[i];
      insert.run({
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

  return {
    getProject(id: string) {
      try {
        const row = selectOne.get(ownerId, id) as ProjectRow | undefined;
        if (!row) return { success: true, value: null };
        const parsed = parsePayload(row);
        if (!parsed.success) return parsed;
        return { success: true, value: parsed.value };
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
        const written = updateIfMatch.run({
          id,
          owner_id: ownerId,
          name: updated.name,
          payload: JSON.stringify(updated),
          updated_at: updated.updatedAt,
          expected_updated_at: parsed.value.updatedAt,
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
        remove.run(ownerId, id);
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

    putProject(project, expectedUpdatedAt) {
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
        const params = {
          id: project.id,
          owner_id: ownerId,
          name: project.name,
          payload: JSON.stringify(project),
          updated_at: project.updatedAt,
          expected_updated_at: expectedUpdatedAt,
        };
        const written =
          expectedUpdatedAt === undefined
            ? update.run(params)
            : updateIfMatch.run(params);
        if (written.changes === 0) {
          return {
            success: false,
            error: persistError(
              expectedUpdatedAt === undefined ? "NotFound" : "Conflict",
              expectedUpdatedAt === undefined
                ? `No saved project with id ${project.id}`
                : "Project was updated elsewhere",
            ),
          };
        }
        return { success: true, value: project };
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
