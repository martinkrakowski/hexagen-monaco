/**
 * Value Object representing the persistent state of a Monaco editor session.
 * Immutable, serializable, minimal surface area for round-trip storage.
 *
 * Lives in domain layer — no framework, no storage mechanics.
 */
export interface MonacoSessionState {
  /**
   * Unique project identifier (matches Project.id)
   */
  projectId: string;

  /**
   * Current full editor content (string buffer).
   * Future evolution: switch to patch/diff model for efficiency.
   */
  content: string;

  /**
   * Last modification timestamp (used for staleness checks, conflict resolution)
   */
  lastModified: Date;

  // Future optional extensions (add when needed, maintain backward compatibility):
  // activeModelUri?: string;
  // cursorPosition?: { lineNumber: number; column: number };
  // versionId?: number;           // Monaco model version
  // undoStackReference?: string;  // Hash or pointer for integrity
}
