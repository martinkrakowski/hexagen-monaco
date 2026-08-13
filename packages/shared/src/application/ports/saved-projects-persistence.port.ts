import type { Result } from "../../errors/result.js";
import type { PersistenceError } from "../../domain/persistence-error.js";
import type { SavedProject } from "../../domain/saved-project.js";

export interface SavedProjectsPersistencePort {
  loadProjects(): Promise<Result<SavedProject[], PersistenceError>>;
  /**
   * Whole-array replace. MIGRATION STEPS ONLY (the LS→IDB copy and the schema
   * version stamps, which by design rewrite every record from a just-loaded
   * array). Application writers must NOT call this: a whole-array save from a
   * possibly-stale in-memory snapshot silently reverts every concurrent
   * record-level write (the pre-Phase-3 clobber class, ADR-0045). Use
   * `createProjectRecord` / `updateProjectRecord` / `deleteProjectRecord`.
   */
  saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>>;
  /**
   * Clobber-safe single-record create: the adapter does a FRESH read of the
   * stored array, rejects a duplicate `project.id` with `Conflict` (a create
   * must never silently overwrite an existing record), and PREPENDS the new
   * record — newest-first, matching the UI's ordering of new projects. Sibling
   * records are written back byte-identical, so a caller holding a stale
   * snapshot cannot revert other writers' records the way a whole-array
   * `saveProjects` from that snapshot would.
   *
   * Returns the record as persisted.
   */
  createProjectRecord(
    project: SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>>;
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
  /**
   * Clobber-safe single-record delete: fresh read, remove the matching record,
   * siblings written back byte-identical.
   *
   * Contract: IDEMPOTENT — an absent `id` resolves success (without a write).
   * This deliberately diverges from `updateProjectRecord`'s NotFound contract
   * (decision D6): the hook's delete is optimistic-with-revert, so if
   * "already gone" surfaced as an error, deleting a project that another
   * instance (or a slightly-behind snapshot) had already removed would trip
   * the revert arm and RESURRECT the locally-deleted row in the UI. For an
   * update, NotFound is real signal (there is nothing to apply the patch to);
   * for a delete, the desired end state — record absent — is already true.
   */
  deleteProjectRecord(id: string): Promise<Result<void, PersistenceError>>;
}
