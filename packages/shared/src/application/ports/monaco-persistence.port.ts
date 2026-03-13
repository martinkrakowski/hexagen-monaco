import type { Result } from "../../errors/result.js";
import type { MonacoSession } from "../../domain/monaco-session.js";
import type { SessionMetadata } from "../../domain/session-metadata.js";
import type { PersistenceError } from "../../domain/persistence-error.js";

/**
 * Port defining persistence operations for Monaco editor sessions.
 * Implemented by infrastructure adapters (e.g. LocalStoragePersistenceAdapter).
 *
 * Follows hexagonal rules: port is pure, no dependencies on concrete storage.
 *
 * Part of the shared kernel — imported by monaco-orchestration and web-driver.
 */
export interface MonacoPersistencePort {
  loadLatestSession(
    projectId: string,
  ): Promise<Result<MonacoSession | null, PersistenceError>>;

  saveSession(
    session: MonacoSession,
  ): Promise<Result<MonacoSession, PersistenceError>>;

  listSessions(
    projectId: string,
    limit?: number,
  ): Promise<Result<SessionMetadata[], PersistenceError>>;

  deleteSession(sessionId: string): Promise<Result<void, PersistenceError>>;

  clearProjectSessions(
    projectId: string,
  ): Promise<Result<void, PersistenceError>>;
}
