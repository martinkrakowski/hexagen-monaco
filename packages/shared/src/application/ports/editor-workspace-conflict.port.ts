/**
 * A workspace conflict awaiting the user's choice. Only the kinds that have
 * a server copy to choose against are offered; "discard" and
 * "deleted-elsewhere" conflicts stay silent.
 */
export interface PendingWorkspaceConflict {
  sessionId: string;
  where: "load" | "save" | "lift" | "first-save";
  /** ISO time the conflict was seen. */
  at: string;
}

/**
 * Port for listing and resolving a project's pending workspace conflict.
 * Implemented by the cached editor workspace adapter; the UI lane consumes it.
 *
 * Part of the shared kernel — imported by web-driver.
 */
export interface EditorWorkspaceConflictPort {
  getPendingConflict(sessionId: string): PendingWorkspaceConflict | null;
  /** Called whenever any pending entry is added or removed. */
  subscribe(listener: () => void): () => void;
}
