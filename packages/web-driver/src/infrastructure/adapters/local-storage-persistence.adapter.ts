import type {
  EditorWorkspacePersistencePort,
  MonacoPersistencePort,
  MonacoSession,
  PersistenceError,
  PersistedEditorWorkspace,
  Result,
  SessionMetadata,
  WizardDraft,
  WizardPersistencePort,
} from "@hexagen/shared";

const WIZARD_DRAFT_KEY = "hexagen-wizard-draft";
const WORKSPACE_KEY_PREFIX = "hexagen-editor-workspace-";

export class LocalStoragePersistenceAdapter
  implements
    MonacoPersistencePort,
    WizardPersistencePort,
    EditorWorkspacePersistencePort
{
  async loadLatestSession(
    projectId: string,
  ): Promise<Result<MonacoSession | null, PersistenceError>> {
    try {
      const _id = `monaco-session-${projectId}`;
      const raw = localStorage.getItem(_id);
      if (!raw) return { success: true, value: null };

      const session = JSON.parse(raw) as MonacoSession;
      return { success: true, value: session };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed",
          message: "Failed to load session",
          cause: e,
        },
      };
    }
  }

  async saveSession(
    session: MonacoSession,
  ): Promise<Result<MonacoSession, PersistenceError>> {
    try {
      const key = `monaco-session-${session.id}`;
      localStorage.setItem(key, JSON.stringify(session));
      return { success: true, value: session };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "SerializationFailed",
          message: "Failed to save session",
          cause: e,
        },
      };
    }
  }

  async listSessions(
    _projectId: string,
    _limit?: number,
  ): Promise<Result<SessionMetadata[], PersistenceError>> {
    // MVP stub — localStorage does not support listing
    return { success: true, value: [] };
  }

  async deleteSession(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    try {
      localStorage.removeItem(`monaco-session-${sessionId}`);
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "Unknown",
          message: "Failed to delete session",
          cause: e,
        },
      };
    }
  }

  async clearProjectSessions(
    _projectId: string,
  ): Promise<Result<void, PersistenceError>> {
    // MVP stub — localStorage does not support prefix delete
    return { success: true, value: undefined };
  }

  async saveDraft(draft: WizardDraft): Promise<Result<WizardDraft, Error>> {
    try {
      const payload: WizardDraft = {
        ...draft,
        updatedAt: Date.now(),
      };
      localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(payload));
      return { success: true, value: payload };
    } catch (e) {
      return {
        success: false,
        error: new Error(
          e instanceof Error ? e.message : "Failed to save draft",
        ),
      };
    }
  }

  async loadDraft(): Promise<Result<WizardDraft | null, Error>> {
    try {
      const raw = localStorage.getItem(WIZARD_DRAFT_KEY);
      if (!raw) return { success: true, value: null };

      const draft = JSON.parse(raw) as WizardDraft;
      if (!draft.id || typeof draft.savedAtStep !== "number") {
        return { success: false, error: new Error("Invalid draft format") };
      }
      return { success: true, value: draft };
    } catch (e) {
      return {
        success: false,
        error: new Error(
          e instanceof Error ? e.message : "Failed to load draft",
        ),
      };
    }
  }

  async clearDraft(): Promise<Result<void, Error>> {
    try {
      localStorage.removeItem(WIZARD_DRAFT_KEY);
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: new Error(
          e instanceof Error ? e.message : "Failed to clear draft",
        ),
      };
    }
  }

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
