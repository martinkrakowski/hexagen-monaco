import type {
  SavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";
import type {
  MigrationStep,
  MigrationResult,
} from "./migration-orchestrator.js";

const SAVED_PROJECTS_KEY = "hexagen-saved-projects";
const MIN_SCHEMA_VERSION = 2;

export class SavedProjectsMigrationStep implements MigrationStep {
  id = "saved-projects-schema-validation";
  description = "Validate saved projects have schema version >= 2";

  private savedProjectsPersistence: SavedProjectsPersistencePort;

  constructor(savedProjectsPersistence: SavedProjectsPersistencePort) {
    this.savedProjectsPersistence = savedProjectsPersistence;
  }

  async migrate(): Promise<MigrationResult> {
    const raw = localStorage.getItem(SAVED_PROJECTS_KEY);
    if (!raw) {
      return { success: true, recordsMigrated: 0, errors: [] };
    }

    try {
      const loadResult = await this.savedProjectsPersistence.loadProjects();
      if (!loadResult.success) {
        return {
          success: false,
          recordsMigrated: 0,
          errors: ["Failed to load saved projects for validation"],
        };
      }

      const projects = loadResult.value as SavedProject[];
      const invalidProjects = projects.filter(
        (p) =>
          typeof p.schemaVersion !== "number" ||
          p.schemaVersion < MIN_SCHEMA_VERSION,
      );

      if (invalidProjects.length > 0) {
        return {
          success: false,
          recordsMigrated: 0,
          errors: [
            `${invalidProjects.length} project(s) have schema version < ${MIN_SCHEMA_VERSION}`,
          ],
        };
      }

      return { success: true, recordsMigrated: projects.length, errors: [] };
    } catch (e) {
      return {
        success: false,
        recordsMigrated: 0,
        errors: [
          e instanceof Error ? e.message : "Failed to validate saved projects",
        ],
      };
    }
  }

  async verify(): Promise<boolean> {
    const loadResult = await this.savedProjectsPersistence.loadProjects();
    if (!loadResult.success) return false;

    const projects = loadResult.value as SavedProject[];
    return projects.every(
      (p) =>
        typeof p.schemaVersion === "number" &&
        p.schemaVersion >= MIN_SCHEMA_VERSION,
    );
  }
}
