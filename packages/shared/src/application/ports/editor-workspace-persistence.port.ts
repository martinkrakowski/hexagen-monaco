import type { Result } from "../../errors/result.js";
import type { PersistenceError } from "../../domain/persistence-error.js";
import type { PersistedEditorWorkspace } from "../../domain/persisted-editor-workspace.js";

/**
 * Port defining persistence operations for the multi-file editor workspace.
 * Implemented by infrastructure adapters (e.g. LocalStoragePersistenceAdapter).
 *
 * Follows hexagonal rules: port is pure, no dependencies on concrete storage.
 *
 * Part of the shared kernel — imported by web-driver.
 */
export interface EditorWorkspacePersistencePort {
  saveWorkspace(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
  ): Promise<Result<void, PersistenceError>>;

  loadWorkspace(
    sessionId: string,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>>;

  clearWorkspace(sessionId: string): Promise<Result<void, PersistenceError>>;
}
