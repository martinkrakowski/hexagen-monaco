import type { Result } from "../../errors/result.js";
import type { PersistenceError } from "../../domain/persistence-error.js";
import type { PersistedEditorWorkspace } from "../../domain/persisted-editor-workspace.js";

/**
 * A workspace conflict awaiting the user's choice. Only the kinds that have
 * a server copy to choose against are offered; "discard" and
 * "deleted-elsewhere" conflicts are not a choice (see `WorkspaceSyncPause`).
 */
export interface PendingWorkspaceConflict {
  sessionId: string;
  where: "load" | "save" | "lift" | "first-save";
  /** ISO time the conflict was seen. */
  at: string;
}

/**
 * A project whose workspace is not being synced although there is no choice
 * to offer. It lasts until the next load of the project.
 *
 * - "deleted-elsewhere": the server copy was deleted on another device; this
 *   browser's copy is kept and is not uploaded again.
 * - "upload-failed": the first upload of this browser's copy failed.
 * - "choice-not-recorded": "use the other device's copy" replaced the browser
 *   copy (the earlier one is in the backups) but could not record it.
 */
export interface WorkspaceSyncPause {
  sessionId: string;
  reason: "deleted-elsewhere" | "upload-failed" | "choice-not-recorded";
  /** ISO time the pause began. */
  at: string;
}

/**
 * The copy that lost when a conflict was resolved. It is written in this
 * browser BEFORE the losing copy is overwritten; a resolve whose backup
 * cannot be written overwrites nothing.
 */
export interface WorkspaceConflictBackup {
  sessionId: string;
  /** Which copy lost: this browser's, or the one the server held. */
  lost: "this-device" | "other-device";
  /** ISO time of the resolve. */
  at: string;
  /** The server revision the choice was made against. */
  serverRev: number;
  /** The signed-in user who made the choice. */
  ownerId: string;
  workspace: PersistedEditorWorkspace;
}

/**
 * Port for listing and resolving a project's pending workspace conflict.
 * Implemented by the cached editor workspace adapter; the UI lane consumes it.
 *
 * Requirements on the caller:
 * - After ANY return of `useOtherDeviceCopy`, success or failure, the caller
 *   MUST cancel its own pending saves, load the workspace again
 *   (`loadWorkspace`) and show what it returns. From the moment the browser
 *   copy is being replaced until that load has ANSWERED, every
 *   `saveWorkspace` of the id is refused with a `Conflict` error and writes
 *   nothing, so that an autosave of the old in-memory content cannot
 *   overwrite the copy that was taken. (A failure that changed nothing
 *   refuses no save; loading again is then harmless.)
 * - A second call of the same resolve while one is running returns the first
 *   call's result; the other resolve is refused until the first has ended.
 * - When the server copy has been deleted meanwhile, `useOtherDeviceCopy`
 *   fails (there is nothing to take) and `keepThisDeviceCopy` uploads this
 *   browser's copy as a new one.
 *
 * Part of the shared kernel — imported by web-driver.
 */
export interface EditorWorkspaceConflictPort {
  getPendingConflict(sessionId: string): PendingWorkspaceConflict | null;
  /** Why the project is not syncing when there is no choice to offer. */
  getSyncPause(sessionId: string): WorkspaceSyncPause | null;
  /** Called whenever a pending conflict or a sync pause is added or removed. */
  subscribe(listener: () => void): () => void;
  /**
   * Resolve by keeping this device's copy: the server gets the browser copy.
   * The server's copy is kept as a backup in this browser first.
   */
  keepThisDeviceCopy(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>>;
  /**
   * Resolve by using the other device's copy: the browser gets the server
   * copy. The browser's copy is kept as a backup first.
   */
  useOtherDeviceCopy(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>>;
  /**
   * The backups kept for a project, oldest first (at most three). They are
   * kept in this browser only, survive a discard of the workspace, and are
   * never expired by the application.
   */
  listConflictBackups(
    sessionId: string,
  ): Promise<Result<WorkspaceConflictBackup[], PersistenceError>>;
}
