/**
 * Port for persisting Monaco editor session state.
 * Implemented by infrastructure adapters (e.g. LocalStorage, IndexedDB, remote sync).
 *
 * Lives in domain → no framework or storage-specific imports.
 */
export interface MonacoPersistencePort {
  /**
   * Persist the current session state.
   * @throws PersistenceError if write fails critically (adapter decides what is critical)
   */
  saveSession(session: MonacoSessionState): Promise<void>;

  /**
   * Load the most recent session for a given project.
   * @returns null if no session exists or load fails non-critically
   */
  loadSession(projectId: string): Promise<MonacoSessionState | null>;

  /**
   * Delete the stored session for a project (e.g. on project delete or explicit clear).
   */
  deleteSession(projectId: string): Promise<void>;
}

/**
 * Value Object representing Monaco editor session persistence payload.
 * Minimal surface area — only what needs to survive round-trip.
 * Extensible later (patches, cursor position, undo stack reference, etc.).
 */
export interface MonacoSessionState {
  projectId: string;
  content: string; // full editor content (or diff if we go patch-based later)
  lastModified: Date;
  // Future optional fields:
  // activeModelPath?: string;
  // cursorPosition?: { lineNumber: number; column: number };
  // undoStackHash?: string;     // for integrity check
}
