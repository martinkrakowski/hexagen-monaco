import type { Result } from "../../errors/result.js";
import type { PersistenceError } from "../../domain/persistence-error.js";
import type { SavedProject } from "../../domain/saved-project.js";

export interface SavedProjectsPersistencePort {
  loadProjects(): Promise<Result<SavedProject[], PersistenceError>>;
  saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>>;
}
