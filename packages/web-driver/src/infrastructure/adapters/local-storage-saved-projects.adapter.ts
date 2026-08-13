import type {
  SavedProject,
  SavedProjectsPersistencePort,
  PersistenceError,
  Result,
} from "@hexagen/shared";

const STORAGE_KEY = "hexagen-saved-projects";
// FROZEN. This adapter is the legacy localStorage backend and is no longer
// wired (the live path is IDB; the LS→IDB migration steps own the version
// bumps). Its stamp is deliberately pinned to the v3 era and must NOT track the
// live `SAVED_PROJECT_SCHEMA_VERSION` — resurrecting it should re-derive the
// migration semantics, not silently adopt the current schema.
const CURRENT_SCHEMA_VERSION = 3;
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

        const sv =
          typeof p.schemaVersion === "number"
            ? p.schemaVersion
            : LEGACY_SCHEMA_VERSION;

        if (sv === LEGACY_SCHEMA_VERSION) {
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
        } else if (sv >= 2) {
          // v2 or v3+: round-trip githubLink (v3+), clean legacy gitHubExport
          const project = { ...p } as SavedProject;
          if (project.formState) {
            delete (project.formState as Record<string, unknown>).gitHubExport;
          }
          if (sv < CURRENT_SCHEMA_VERSION) {
            needsMigration = true;
            // githubLink is optional; pre-v3 records simply omit it. Only the
            // schema version needs bumping on round-trip.
            (project as { schemaVersion: number }).schemaVersion =
              CURRENT_SCHEMA_VERSION;
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

  /**
   * Serializes the record-level read-merge-write methods (mirrors the IDB
   * adapter's enqueueWrite). localStorage itself is synchronous, but
   * `await this.loadProjects()` yields a microtask between a method's read and
   * its write — two record ops started in the same tick would otherwise read
   * the same array, and the later write would silently discard the earlier
   * one, violating the port's clobber-safety contract.
   * `loadProjects`/`saveProjects` stay UNQUEUED: they are the internal helpers
   * the queued methods compose over (queueing them would deadlock the chain),
   * and as port methods they are migration-step-only single calls with no
   * read-merge-write of their own to protect.
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  private enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(op, op);
    // Keep the chain alive on failure; the caller still sees the rejection.
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * Port-contract compliance for this FROZEN legacy adapter: composed from its
   * own load/save, serialized through the write queue. The live IDB adapter
   * implements the real fresh-read semantics. Duplicate ids reject with
   * `Conflict`, per the port contract.
   */
  createProjectRecord(
    project: SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    return this.enqueueWrite(async () => {
      const loaded = await this.loadProjects();
      if (!loaded.success) return loaded;
      if (loaded.value.some((p) => p.id === project.id)) {
        return {
          success: false,
          error: {
            kind: "Conflict",
            message: `A saved project with id ${project.id} already exists`,
          },
        };
      }
      const written = await this.saveProjects([project, ...loaded.value]);
      if (!written.success) return written;
      return { success: true, value: project };
    });
  }

  /**
   * Port-contract compliance for this FROZEN legacy adapter, composed from its
   * own load/save and serialized through the write queue. IDEMPOTENT per the
   * port contract: an absent id resolves success without a write (deliberate
   * divergence from updateProjectRecord's NotFound — see the port's D6
   * rationale).
   */
  deleteProjectRecord(id: string): Promise<Result<void, PersistenceError>> {
    return this.enqueueWrite(async () => {
      const loaded = await this.loadProjects();
      if (!loaded.success) return loaded;
      const next = loaded.value.filter((p) => p.id !== id);
      if (next.length === loaded.value.length) {
        return { success: true, value: undefined };
      }
      return this.saveProjects(next);
    });
  }

  /**
   * Port-contract compliance for this FROZEN legacy adapter: composed from its
   * own load/save, serialized through the write queue. The live IDB adapter
   * implements the real fresh-read semantics.
   */
  updateProjectRecord(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    return this.enqueueWrite(async () => {
      const loaded = await this.loadProjects();
      if (!loaded.success) return loaded;
      const index = loaded.value.findIndex((p) => p.id === id);
      if (index === -1) {
        return {
          success: false,
          error: {
            kind: "NotFound",
            message: `No saved project with id ${id}`,
          },
        };
      }
      const current = loaded.value[index];
      const updated = updater(current);
      // Same-reference return = "nothing changed" — skip the write.
      if (updated === current) return { success: true, value: current };
      const next = [...loaded.value];
      next[index] = updated;
      const written = await this.saveProjects(next);
      if (!written.success) return written;
      return { success: true, value: updated };
    });
  }
}
