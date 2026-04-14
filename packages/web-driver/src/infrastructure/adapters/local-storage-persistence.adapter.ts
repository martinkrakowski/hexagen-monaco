import type {
  MonacoPersistencePort,
  MonacoSession,
  PersistenceError,
  Result,
  SessionMetadata,
  WizardDraft,
  WizardPersistencePort,
} from "@hexagen/shared";

const WIZARD_DRAFT_KEY = "hexagen-wizard-draft";

export class LocalStoragePersistenceAdapter
  implements MonacoPersistencePort, WizardPersistencePort
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
    projectId: string,
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
}
