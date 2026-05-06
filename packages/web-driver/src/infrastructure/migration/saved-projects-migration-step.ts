import type {
  SavedProject,
  SavedProjectsPersistencePort,
  PersistenceDomainRegistryPort,
} from "@hexagen/shared";
import type {
  MigrationStep,
  MigrationResult,
} from "./migration-orchestrator.js";

const LS_KEY = "hexagen-saved-projects";
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

export class SavedProjectsMigrationStep implements MigrationStep {
  id = "saved-projects-ls-to-idb";
  description = "Migrate saved projects from localStorage to IndexedDB";

  private savedProjectsPersistence: SavedProjectsPersistencePort;
  private domainRegistry: PersistenceDomainRegistryPort;

  constructor(
    savedProjectsPersistence: SavedProjectsPersistencePort,
    domainRegistry: PersistenceDomainRegistryPort,
  ) {
    this.savedProjectsPersistence = savedProjectsPersistence;
    this.domainRegistry = domainRegistry;
  }

  async migrate(): Promise<MigrationResult> {
    if (typeof window === "undefined") {
      return { success: true, recordsMigrated: 0, errors: [] };
    }

    try {
      const isMigratedResult =
        await this.domainRegistry.isMigrated("saved-projects");
      if (isMigratedResult.success && isMigratedResult.value) {
        return { success: true, recordsMigrated: 0, errors: [] };
      }

      const raw = localStorage.getItem(LS_KEY);
      if (!raw) {
        await this.domainRegistry.markMigrated("saved-projects");
        return { success: true, recordsMigrated: 0, errors: [] };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          success: false,
          recordsMigrated: 0,
          errors: ["Failed to parse saved projects from localStorage"],
        };
      }

      if (!Array.isArray(parsed)) {
        await this.domainRegistry.markMigrated("saved-projects");
        return { success: true, recordsMigrated: 0, errors: [] };
      }

      const migrated: SavedProject[] = [];

      for (const p of parsed) {
        if (!p || typeof p.id !== "string" || typeof p.formState !== "object") {
          continue;
        }

        if (p.schemaVersion === LEGACY_SCHEMA_VERSION) {
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
          const formState = { ...(p.formState as Record<string, unknown>) };
          delete formState.gitHubExport;
          migrated.push({
            ...p,
            formState: formState as SavedProject["formState"],
          } as SavedProject);
        }
      }

      const saveResult =
        await this.savedProjectsPersistence.saveProjects(migrated);
      if (!saveResult.success) {
        return {
          success: false,
          recordsMigrated: 0,
          errors: ["Failed to write saved projects to IndexedDB"],
        };
      }

      const loadResult = await this.savedProjectsPersistence.loadProjects();
      if (!loadResult.success || loadResult.value.length !== migrated.length) {
        return {
          success: false,
          recordsMigrated: 0,
          errors: ["Verification failed: read-back mismatch from IndexedDB"],
        };
      }

      localStorage.removeItem(LS_KEY);
      await this.domainRegistry.markMigrated("saved-projects");

      return {
        success: true,
        recordsMigrated: migrated.length,
        errors: [],
      };
    } catch (e) {
      return {
        success: false,
        recordsMigrated: 0,
        errors: [
          e instanceof Error ? e.message : "Failed to migrate saved projects",
        ],
      };
    }
  }

  async verify(): Promise<boolean> {
    if (typeof window === "undefined") return true;

    const isMigratedResult =
      await this.domainRegistry.isMigrated("saved-projects");
    if (!isMigratedResult.success || !isMigratedResult.value) return false;

    const loadResult = await this.savedProjectsPersistence.loadProjects();
    if (!loadResult.success) return false;

    return loadResult.value.every(
      (p) =>
        typeof p.schemaVersion === "number" &&
        p.schemaVersion >= CURRENT_SCHEMA_VERSION,
    );
  }
}
