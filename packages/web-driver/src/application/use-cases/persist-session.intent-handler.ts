import { MonacoPersistencePort } from '../../domain';
import type { MonacoSessionState } from '../../domain';

/**
 * Intent handler for persisting Monaco editor session state.
 * Application layer — orchestrates persistence via port (constructor injection).
 * No direct storage access — only calls port methods.
 */
export class PersistSessionIntentHandler {
  constructor(private readonly persistencePort: MonacoPersistencePort) {}

  async handleSave(session: MonacoSessionState): Promise<{
    success: boolean;
    message: string;
    requiresConfirmation?: boolean;
  }> {
    try {
      await this.persistencePort.saveSession(session);
      return {
        success: true,
        message: `Session for project ${session.projectId} persisted successfully`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to persist session: ${err instanceof Error ? err.message : 'Unknown error'}`,
        requiresConfirmation: false,
      };
    }
  }

  async handleLoad(projectId: string): Promise<{
    session: MonacoSessionState | null;
    success: boolean;
    message: string;
  }> {
    try {
      const session = await this.persistencePort.loadSession(projectId);
      return {
        session,
        success: session !== null,
        message: session
          ? `Session loaded for project ${projectId}`
          : `No saved session found for project ${projectId}`,
      };
    } catch (err) {
      return {
        session: null,
        success: false,
        message: `Load failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }
}
