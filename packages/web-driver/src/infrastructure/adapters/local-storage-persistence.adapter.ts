import { MonacoPersistencePort } from '../../domain/ports/out/monaco-persistence.port';
import type { MonacoSessionState } from '../../domain/monaco-session-state.vo';

export class LocalStoragePersistenceAdapter implements MonacoPersistencePort {
  private readonly STORAGE_KEY_PREFIX = 'hexagen:monaco:session:';

  async saveSession(session: MonacoSessionState): Promise<void> {
    try {
      const key = this.getStorageKey(session.projectId);
      const serialized = JSON.stringify({
        projectId: session.projectId,
        content: session.content,
        lastModified: session.lastModified.toISOString(),
        // Future: add patches, undo stack reference, etc.
      });

      localStorage.setItem(key, serialized);
    } catch (err) {
      console.warn('Failed to persist Monaco session to localStorage', err);
      throw err; // Let caller decide retry / fallback policy
    }
  }

  async loadSession(projectId: string): Promise<MonacoSessionState | null> {
    try {
      const key = this.getStorageKey(projectId);
      const raw = localStorage.getItem(key);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);

      return {
        projectId: parsed.projectId,
        content: parsed.content ?? '',
        lastModified: new Date(parsed.lastModified),
      };
    } catch (err) {
      console.warn('Failed to load Monaco session from localStorage', err);
      return null;
    }
  }

  async deleteSession(projectId: string): Promise<void> {
    const key = this.getStorageKey(projectId);
    localStorage.removeItem(key);
  }

  private getStorageKey(projectId: string): string {
    return `${this.STORAGE_KEY_PREFIX}${projectId}`;
  }
}
