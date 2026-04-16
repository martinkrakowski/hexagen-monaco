/**
 * Value Object representing the persistent state of the multi-file editor workspace.
 * Immutable, serializable, minimal surface area for round-trip storage.
 *
 * Lives in domain layer — no framework, no storage mechanics.
 *
 * Part of the shared kernel — imported by web-driver.
 */
export interface PersistedEditorWorkspaceFile {
  content: string;
  isNew: boolean;
  dirty: boolean;
  updatedAt: number;
}

export type PersistedEditorWorkspace = {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly updatedAt: number;
  readonly selectedFileId: string | null;
  readonly files: Record<string, PersistedEditorWorkspaceFile>;
};
