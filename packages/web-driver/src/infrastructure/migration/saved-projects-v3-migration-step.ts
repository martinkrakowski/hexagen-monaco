import type {
  SavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";
import type {
  MigrationStep,
  MigrationResult,
} from "./migration-orchestrator.js";

/**
 * Post LS→IDB schema bump migration for SavedProject v2 → v3.
 *
 * Adds support for optional githubLink (connected repo) without editing
 * the existing "saved-projects-ls-to-idb" step (which is ID-tracked and
 * already marked complete for prior users).
 *
 * ID-tracked via MigrationOrchestrator step.id; skips if already run.
 * Operates on the live IDB backend (via the injected port).
 */
export class SavedProjectsV3MigrationStep implements MigrationStep {
  id = "saved-projects-v2-to-v3";
  description = "Bump saved projects schema v2→v3 (add githubLink for connected repos)";

  private savedProjectsPersistence: SavedProjectsPersistencePort;

  constructor(savedProjectsPersistence: SavedProjectsPersistencePort) {
    this.savedProjectsPersistence = savedProjectsPersistence;
  }

  async migrate(): Promise<MigrationResult> {
    if (typeof window === "undefined") {
      return { success: true, recordsMigrated: 0, errors: [] };
    }

    try {
      const loadResult = await this.savedProjectsPersistence.loadProjects();
      if (!loadResult.success) {
        return {
          success: false,
          recordsMigrated: 0,
          errors: ["Failed to load saved projects for v3 migration"],
        };
      }

      const projects = loadResult.value;
      let recordsMigrated = 0;

      const migrated: SavedProject[] = projects.map((p) => {
        if (typeof p.schemaVersion !== "number" || p.schemaVersion < 3) {
          recordsMigrated += 1;
          return {
            ...p,
            schemaVersion: 3,
            // ensure optional field present for round-trip (undefined ok)
            githubLink: p.githubLink ?? undefined,
          } as SavedProject;
        }
        return p;
      });

      if (recordsMigrated === 0) {
        return { success: true, recordsMigrated: 0, errors: [] };
      }

      const saveResult =
        await this.savedProjectsPersistence.saveProjects(migrated);
      if (!saveResult.success) {
        return {
          success: false,
          recordsMigrated: 0,
          errors: ["Failed to write v3-migrated projects to persistence"],
        };
      }

      // Verification read-back
      const loadVerify = await this.savedProjectsPersistence.loadProjects();
      if (
        !loadVerify.success ||
        loadVerify.value.length !== migrated.length ||
        !loadVerify.value.every(
          (p) =>
            typeof p.schemaVersion === "number" && p.schemaVersion >= 3,
        )
      ) {
        return {
          success: false,
          recordsMigrated: recordsMigrated,
          errors: ["Verification failed: read-back mismatch after v3 upgrade"],
        };
      }

      return {
        success: true,
        recordsMigrated,
        errors: [],
      };
    } catch (e) {
      return {
        success: false,
        recordsMigrated: 0,
        errors: [
          e instanceof Error
            ? e.message
            : "Failed to migrate saved projects to v3",
        ],
      };
    }
  }

  async verify(): Promise<boolean> {
    if (typeof window === "undefined") return true;

    const loadResult = await this.savedProjectsPersistence.loadProjects();
    if (!loadResult.success) return false;

    return loadResult.value.every(
      (p) =>
        typeof p.schemaVersion === "number" && p.schemaVersion >= 3,
    );
  }
}
