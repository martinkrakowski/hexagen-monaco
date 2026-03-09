import type {
  MonacoPersistencePort,
  MonacoSession,
} from '@hexagen/monaco-orchestration';

/**
 * Intent handler for persisting Monaco editor session state.
 * Application layer — orchestrates persistence via port (constructor injection).
 * No direct storage access — only calls port methods.
 */
export class PersistSessionIntentHandler {
  constructor(private readonly persistencePort: MonacoPersistencePort) {}

  async handleSave(
    session: MonacoSession
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.persistencePort.saveSession(session);
    return result.success
      ? {
          success: true,
          message: `Session for project ${session.id} persisted`,
        }
      : { success: false, message: result.error.message };
  }

  async handleLoad(
    projectId: string
  ): Promise<{
    session: MonacoSession | null;
    success: boolean;
    message: string;
  }> {
    const result = await this.persistencePort.loadLatestSession(projectId); // ← loadLatestSession not loadSession
    if (!result.success)
      return { session: null, success: false, message: result.error.message };
    return {
      session: result.value,
      success: result.value !== null,
      message: result.value
        ? `Session loaded for ${projectId}`
        : `No session found for ${projectId}`,
    };
  }
}
