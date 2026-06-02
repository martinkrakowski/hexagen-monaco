import { get, set } from "idb-keyval";
import type {
  SavedProject,
  SavedProjectsPersistencePort,
  PersistenceError,
  Result,
} from "@hexagen/shared";

const SAVED_PROJECTS_KEY = "hexagen:saved-projects";

export class IDBSavedProjectsAdapter implements SavedProjectsPersistencePort {
  async loadProjects(): Promise<Result<SavedProject[], PersistenceError>> {
    try {
      const data = await get<SavedProject[]>(SAVED_PROJECTS_KEY);
      if (!data || !Array.isArray(data)) return { success: true, value: [] };
      // githubLink (v3+) is round-tripped verbatim by idb-keyval structured clone.
      // Pre-v3 records (no field) are valid (optional in SavedProject); migration
      // step ensures upgrade for persisted records.
      return { success: true, value: data };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed",
          message: "Failed to load saved projects from IDB",
          cause: e,
        },
      };
    }
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
    try {
      // githubLink optional field (if present on v3+ records) is persisted as-is.
      await set(SAVED_PROJECTS_KEY, projects);
      return { success: true, value: undefined };
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        return {
          success: false,
          error: {
            kind: "StorageQuotaExceeded",
            message: "IDB storage quota exceeded",
          },
        };
      }
      return {
        success: false,
        error: {
          kind: "SerializationFailed",
          message: "Failed to save projects to IDB",
          cause: e,
        },
      };
    }
  }
}
