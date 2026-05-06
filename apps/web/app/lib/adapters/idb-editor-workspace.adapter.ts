import { get, set, del } from "idb-keyval";
import type {
  EditorWorkspacePersistencePort,
  PersistenceError,
  PersistedEditorWorkspace,
  Result,
} from "@hexagen/shared";

const WORKSPACE_KEY_PREFIX = "hexagen:workspace:";

export class IDBEditorWorkspaceAdapter implements EditorWorkspacePersistencePort {
  async saveWorkspace(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
  ): Promise<Result<void, PersistenceError>> {
    try {
      await set(`${WORKSPACE_KEY_PREFIX}${sessionId}`, workspace);
      return { success: true, value: undefined };
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        return {
          success: false,
          error: {
            kind: "StorageQuotaExceeded",
            message: "IDB storage quota exceeded",
          },
        };
      }
      return {
        success: false,
        error: {
          kind: "SerializationFailed",
          message: "Failed to save workspace to IDB",
          cause: e,
        },
      };
    }
  }

  async loadWorkspace(
    sessionId: string,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>> {
    try {
      const data = await get<PersistedEditorWorkspace>(
        `${WORKSPACE_KEY_PREFIX}${sessionId}`,
      );
      if (!data) return { success: true, value: null };
      if (data.schemaVersion !== 1) return { success: true, value: null };
      return { success: true, value: data };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed",
          message: "Failed to load workspace from IDB",
          cause: e,
        },
      };
    }
  }

  async clearWorkspace(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    try {
      await del(`${WORKSPACE_KEY_PREFIX}${sessionId}`);
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "Unknown",
          message: "Failed to clear workspace from IDB",
          cause: e,
        },
      };
    }
  }
}
