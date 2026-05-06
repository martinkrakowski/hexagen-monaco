import type {
  EditorWorkspacePersistencePort,
  PersistenceError,
  PersistedEditorWorkspace,
  Result,
} from "@hexagen/shared";

const WORKSPACE_KEY_PREFIX = "hexagen-editor-workspace-";

export class LocalStorageEditorWorkspaceAdapter implements EditorWorkspacePersistencePort {
  async saveWorkspace(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
  ): Promise<Result<void, PersistenceError>> {
    try {
      const key = `${WORKSPACE_KEY_PREFIX}${sessionId}`;
      localStorage.setItem(key, JSON.stringify(workspace));
      return { success: true, value: undefined };
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        return {
          success: false,
          error: {
            kind: "StorageQuotaExceeded" as const,
            message: "Storage quota exceeded",
          },
        };
      }
      return {
        success: false,
        error: {
          kind: "SerializationFailed" as const,
          message: "Failed to save workspace",
          cause: e,
        },
      };
    }
  }

  async loadWorkspace(
    sessionId: string,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    try {
      const key = `${WORKSPACE_KEY_PREFIX}${sessionId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return { success: true, value: null };

      const workspace = JSON.parse(raw) as PersistedEditorWorkspace;
      if (workspace.schemaVersion !== 1) {
        return { success: true, value: null };
      }
      return { success: true, value: workspace };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed" as const,
          message: "Failed to load workspace",
          cause: e,
        },
      };
    }
  }

  async clearWorkspace(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    try {
      const key = `${WORKSPACE_KEY_PREFIX}${sessionId}`;
      localStorage.removeItem(key);
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "Unknown" as const,
          message: "Failed to clear workspace",
          cause: e,
        },
      };
    }
  }
}
