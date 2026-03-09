// packages/monaco-orchestration/src/application/ports/out/monaco-persistence.port.ts

import type { MonacoSession } from '../../../domain/model/monaco-session/monaco-session';
import type { Result } from '@hexagen/shared/errors';

/**
 * Port defining persistence operations for Monaco editor sessions.
 * Implemented by infrastructure adapters (e.g. LocalStoragePersistenceAdapter).
 *
 * Follows hexagonal rules: port is pure, no dependencies on concrete storage.
 */
export interface MonacoPersistencePort {
  loadLatestSession(
    projectId: string
  ): Promise<Result<MonacoSession | null, PersistenceError>>;

  saveSession(
    session: MonacoSession
  ): Promise<Result<MonacoSession, PersistenceError>>;

  listSessions(
    projectId: string,
    limit?: number
  ): Promise<Result<SessionMetadata[], PersistenceError>>;

  deleteSession(sessionId: string): Promise<Result<void, PersistenceError>>;

  clearProjectSessions(
    projectId: string
  ): Promise<Result<void, PersistenceError>>;
}

/**
 * Lightweight metadata for session listing / picker.
 * Does NOT include full editor model content.
 */
export interface SessionMetadata {
  sessionId: string;
  projectId: string;
  timestamp: Date;
  lastModified: Date;
  patchCount: number;
  description?: string;
}

/**
 * Discriminated union of persistence-specific errors.
 */
export type PersistenceError =
  | { kind: 'NotFound'; message: string }
  | { kind: 'StorageQuotaExceeded'; message: string }
  | { kind: 'SerializationFailed'; message: string; cause?: unknown }
  | { kind: 'DeserializationFailed'; message: string; cause?: unknown }
  | { kind: 'Unknown'; message: string; cause?: unknown };
