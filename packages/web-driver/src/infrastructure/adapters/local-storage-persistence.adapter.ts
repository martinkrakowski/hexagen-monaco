import type {
  MonacoPersistencePort,
  MonacoSession,
  PersistenceError,
  SessionMetadata,
} from '@hexagen/monaco-orchestration';
import type { Result } from '@hexagen/shared';

export class LocalStoragePersistenceAdapter implements MonacoPersistencePort {
  async loadLatestSession(
    projectId: string
  ): Promise<Result<MonacoSession | null, PersistenceError>> {
    try {
      const key = `monaco-session-${projectId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return { success: true, value: null };

      const session = JSON.parse(raw) as MonacoSession;
      return { success: true, value: session };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: 'DeserializationFailed',
          message: 'Failed to load session',
          cause: e,
        },
      };
    }
  }

  async saveSession(
    session: MonacoSession
  ): Promise<Result<MonacoSession, PersistenceError>> {
    try {
      const key = `monaco-session-${session.id}`;
      localStorage.setItem(key, JSON.stringify(session));
      return { success: true, value: session };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: 'SerializationFailed',
          message: 'Failed to save session',
          cause: e,
        },
      };
    }
  }

  async listSessions(
    projectId: string,
    limit?: number
  ): Promise<Result<SessionMetadata[], PersistenceError>> {
    // MVP stub — localStorage does not support listing
    return { success: true, value: [] };
  }

  async deleteSession(
    sessionId: string
  ): Promise<Result<void, PersistenceError>> {
    try {
      localStorage.removeItem(`monaco-session-${sessionId}`);
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: 'Unknown',
          message: 'Failed to delete session',
          cause: e,
        },
      };
    }
  }

  async clearProjectSessions(
    projectId: string
  ): Promise<Result<void, PersistenceError>> {
    // MVP stub — localStorage does not support prefix delete
    return { success: true, value: undefined };
  }
}
