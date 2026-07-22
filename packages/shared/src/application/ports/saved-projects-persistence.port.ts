import type { Result } from "../../errors/result.js";
import type { PersistenceError } from "../../domain/persistence-error.js";
import type { SavedProject } from "../../domain/saved-project.js";

export interface SavedProjectsPersistencePort {
  loadProjects(): Promise<Result<SavedProject[], PersistenceError>>;
  saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>>;
  /**
   * Clobber-safe single-record update (read-merge-write): the adapter does a
   * FRESH read of the stored array, applies `updater` to the matching record
   * only, and writes the array back — so a caller holding a stale in-memory
   * snapshot cannot silently revert other records (or other writers' changes
   * to this record's siblings) the way a whole-array `saveProjects` from that
   * snapshot would. Live-session layer writes (Phase 3) MUST use this.
   *
   * Contract: resolves `NotFound` when no record has `id`; an updater that
   * returns its argument unchanged (same reference) skips the write; returns
   * the updated record as persisted.
   */
  updateProjectRecord(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>>;
}
