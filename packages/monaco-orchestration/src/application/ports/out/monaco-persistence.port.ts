import type { MonacoSession } from '../../../domain/model/monaco-session/monaco-session';
import type { Result } from '@hexagen/shared/errors'; // assuming shared Result type exists; adjust if in another shared location

/**
 * Port defining persistence operations for Monaco editor sessions.
 * Implemented by infrastructure adapters (e.g. LocalStoragePersistenceAdapter).
 *
 * Follows hexagonal rules: port is pure, no dependencies on concrete storage.
 */
export interface MonacoPersistencePort {
  /**
   * Loads the most recent session for a given project identifier.
   * Returns null if no session exists.
   */
  loadLatestSession(
    projectId: string
  ): Promise<Result<MonacoSession | null, PersistenceError>>;

  /**
   * Saves a complete Monaco session snapshot.
   * Overwrites any existing session with the same projectId + timestamp.
   * Returns the saved session with assigned metadata if successful.
   */
  saveSession(
    session: MonacoSession
  ): Promise<Result<MonacoSession, PersistenceError>>;

  /**
   * Lists available session metadata for a project (without full content).
   * Useful for session picker UI or undo history preview.
   * Sorted by timestamp descending.
   */
  listSessions(
    projectId: string,
    limit?: number
  ): Promise<Result<SessionMetadata[], PersistenceError>>;

  /**
   * Deletes a specific session by its unique identifier.
   * Returns success even if session didn't exist (idempotent).
   */
  deleteSession(sessionId: string): Promise<Result<void, PersistenceError>>;

  /**
   * Clears all sessions for a project (destructive — gated behind intent confirmation).
   */
  clearProjectSessions(
    projectId: string
  ): Promise<Result<void, PersistenceError>>;
}

/**
 * Lightweight metadata for session listing / picker.
 * Does NOT include full editor model content.ddd
 */
export interface SessionMetadata {
  sessionId: string;
  projectId: string;
  timestamp: Date;
  lastModified: Date;
  patchCount: number; // number of applied semantic patches
  description?: string; // optional agent/user note
}

/**
 * Discriminated union of persistence-specific errors.
 * Extendable without breaking consumers.
 */
export type PersistenceError =
  | { kind: 'NotFound'; message: string }
  | { kind: 'StorageQuotaExceeded'; message: string }
  | { kind: 'SerializationFailed'; message: string; cause?: unknown }
  | { kind: 'DeserializationFailed'; message: string; cause?: unknown }
  | { kind: 'Unknown'; message: string; cause?: unknown };
// test line
