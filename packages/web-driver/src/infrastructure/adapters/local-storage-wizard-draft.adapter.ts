import type {
  Result,
  WizardDraft,
  WizardPersistencePort,
} from "@hexagen/shared";

const WIZARD_DRAFT_KEY = "hexagen-wizard-draft";

/**
 * @deprecated Use IDBProjectPersistenceAdapter instead.
 * This adapter stores wizard drafts in localStorage which is
 * not project-scoped and does not support atomic purge.
 * Retained for reference only — remove after ADR-0029 migration is complete.
 */
export class LocalStorageWizardDraftAdapter implements WizardPersistencePort {
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
