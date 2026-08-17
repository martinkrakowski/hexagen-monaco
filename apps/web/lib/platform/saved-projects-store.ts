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

export function createSavedProjectsStore(
  db: Database.Database,
): SavedProjectsPersistencePort {
  const selectAll = db.prepare(
    "SELECT id, name, payload, created_at, updated_at, ord FROM saved_projects ORDER BY ord ASC",
  );
  const selectOne = db.prepare(
    "SELECT id, name, payload, created_at, updated_at, ord FROM saved_projects WHERE id = ?",
  );
  const minOrd = db.prepare(
    "SELECT COALESCE(MIN(ord), 0) AS min_ord FROM saved_projects",
  );
  const insert = db.prepare(`
    INSERT INTO saved_projects (id, name, payload, created_at, updated_at, ord)
    VALUES (@id, @name, @payload, @created_at, @updated_at, @ord)
  `);
  const update = db.prepare(`
    UPDATE saved_projects
       SET name = @name, payload = @payload, updated_at = @updated_at
     WHERE id = @id
  `);
  const remove = db.prepare("DELETE FROM saved_projects WHERE id = ?");
  const clear = db.prepare("DELETE FROM saved_projects");

  const replaceAll = db.transaction((projects: SavedProject[]) => {
    clear.run();
    for (let i = 0; i < projects.length; i += 1) {
      const project = projects[i];
      insert.run({
        id: project.id,
        name: project.name,
        payload: JSON.stringify(project),
        created_at: project.createdAt,
        updated_at: project.updatedAt,
        ord: i,
      });
    }
  });

  return {
    async loadProjects() {
      try {
        const rows = selectAll.all() as ProjectRow[];
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
        const existing = selectOne.get(project.id) as ProjectRow | undefined;
        if (existing) {
          return {
            success: false,
            error: persistError(
              "Conflict",
              `A saved project with id ${project.id} already exists`,
            ),
          };
        }
        const { min_ord } = minOrd.get() as { min_ord: number };
        insert.run({
          id: project.id,
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
        const row = selectOne.get(id) as ProjectRow | undefined;
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
        update.run({
          id,
          name: updated.name,
          payload: JSON.stringify(updated),
          updated_at: updated.updatedAt,
        });
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
        remove.run(id);
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
  };
}
