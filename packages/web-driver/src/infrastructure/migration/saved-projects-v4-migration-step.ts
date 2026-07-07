import type {
  SavedProject,
  SavedProjectsPersistencePort,
} from "@hexagen/shared";
import type {
  MigrationStep,
  MigrationResult,
} from "./migration-orchestrator.js";

/**
 * Schema bump for SavedProject v3 → v4 (introduces optional planning `layers`).
 *
 * Mirrors the v2→v3 step: pre-v4 records simply lack `layers` (the load
 * perimeter defaults it to `[]`), so there is NO data transform — only the
 * stored `schemaVersion` is stamped up to 4. Stamp is skipped entirely when no
 * record needs it, then verified by read-back.
 *
 * ID-tracked via MigrationOrchestrator step.id; skips if already run.
 * Operates on the live IDB backend (via the injected port).
 */
export class SavedProjectsV4MigrationStep implements MigrationStep {
  id = "saved-projects-v3-to-v4";
  description =
    "Bump saved projects schema v3→v4 (introduce optional planning layers)";

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
          errors: ["Failed to load saved projects for v4 migration"],
        };
      }

      const projects = loadResult.value;
      let recordsMigrated = 0;

      const migrated: SavedProject[] = projects.map((p) => {
        // Number.isFinite rejects NaN/Infinity (typeof NaN === "number" would
        // otherwise skip malformed rows and wedge later verification).
        if (!Number.isFinite(p.schemaVersion) || p.schemaVersion < 4) {
          recordsMigrated += 1;
          // `layers` is optional and simply absent on pre-v4 records; only the
          // schema version needs bumping.
          return {
            ...p,
            schemaVersion: 4,
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
          errors: ["Failed to write v4-migrated projects to persistence"],
        };
      }

      // Verification read-back
      const loadVerify = await this.savedProjectsPersistence.loadProjects();
      if (
        !loadVerify.success ||
        loadVerify.value.length !== migrated.length ||
        !loadVerify.value.every(
          (p) => Number.isFinite(p.schemaVersion) && p.schemaVersion >= 4,
        )
      ) {
        return {
          success: false,
          recordsMigrated: recordsMigrated,
          errors: ["Verification failed: read-back mismatch after v4 upgrade"],
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
            : "Failed to migrate saved projects to v4",
        ],
      };
    }
  }

  async verify(): Promise<boolean> {
    if (typeof window === "undefined") return true;

    // Defensive like migrate(): a throwing port would otherwise reject out of
    // the orchestrator's step loop and skip the steps registered after this one
    // for the rest of the boot.
    try {
      const loadResult = await this.savedProjectsPersistence.loadProjects();
      if (!loadResult.success) return false;

      return loadResult.value.every(
        (p) => Number.isFinite(p.schemaVersion) && p.schemaVersion >= 4,
      );
    } catch {
      return false;
    }
  }
}
