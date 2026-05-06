import type {
  SavedProject,
  SavedProjectsPersistencePort,
  PersistenceError,
  Result,
} from "@hexagen/shared";

const STORAGE_KEY = "hexagen-saved-projects";
const CURRENT_SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;

function migrateLegacyProject(legacy: {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  formState: Record<string, unknown>;
  manifestYaml: string;
}): SavedProject {
  const formState = { ...legacy.formState };
  delete formState.gitHubExport;
  return {
    id: legacy.id,
    name: legacy.name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    formState: formState as SavedProject["formState"],
    manifestYaml: legacy.manifestYaml,
  };
}

export class LocalStorageSavedProjectsAdapter implements SavedProjectsPersistencePort {
  async loadProjects(): Promise<Result<SavedProject[], PersistenceError>> {
    try {
      if (typeof window === "undefined") return { success: true, value: [] };

      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { success: true, value: [] };

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return { success: true, value: [] };

      const migrated: SavedProject[] = [];
      let needsMigration = false;

      for (const p of parsed) {
        if (!p || typeof p.id !== "string" || typeof p.formState !== "object") {
          continue;
        }

        if (p.schemaVersion === LEGACY_SCHEMA_VERSION) {
          needsMigration = true;
          migrated.push(
            migrateLegacyProject(
              p as {
                id: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                formState: Record<string, unknown>;
                manifestYaml: string;
              },
            ),
          );
        } else if (p.schemaVersion === CURRENT_SCHEMA_VERSION) {
          const project = p as SavedProject;
          if (project.formState) {
            delete (project.formState as Record<string, unknown>).gitHubExport;
          }
          migrated.push(project);
        }
      }

      if (needsMigration) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      }

      return { success: true, value: migrated };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed",
          message: "Failed to load saved projects",
          cause: e,
        },
      };
    }
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
    try {
      if (typeof window === "undefined")
        return { success: true, value: undefined };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      return { success: true, value: undefined };
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        return {
          success: false,
          error: {
            kind: "StorageQuotaExceeded" as const,
            message: "Storage quota exceeded",
          },
        };
      }
      return {
        success: false,
        error: {
          kind: "SerializationFailed" as const,
          message: "Failed to save projects",
          cause: e,
        },
      };
    }
  }
}
