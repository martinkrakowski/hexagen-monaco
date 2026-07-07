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
  description =
    "Bump saved projects schema v2→v3 (add githubLink for connected repos)";

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
        // Number.isFinite rejects NaN/Infinity (typeof NaN === "number" would
        // otherwise skip malformed rows and wedge later verification).
        if (!Number.isFinite(p.schemaVersion) || p.schemaVersion < 3) {
          recordsMigrated += 1;
          // githubLink is optional and simply absent on pre-v3 records; only the
          // schema version needs bumping.
          return {
            ...p,
            schemaVersion: 3,
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
          (p) => Number.isFinite(p.schemaVersion) && p.schemaVersion >= 3,
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

    // Defensive like migrate(): a throwing port would otherwise reject out of
    // the orchestrator's step loop and skip the steps registered after this one
    // for the rest of the boot. (Kept in lockstep with the v4 step's verify.)
    try {
      const loadResult = await this.savedProjectsPersistence.loadProjects();
      if (!loadResult.success) return false;

      return loadResult.value.every(
        (p) => Number.isFinite(p.schemaVersion) && p.schemaVersion >= 3,
      );
    } catch {
      return false;
    }
  }
}
