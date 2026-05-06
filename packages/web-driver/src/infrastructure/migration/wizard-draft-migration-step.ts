import type { WizardDraft, WizardPersistencePort } from "@hexagen/shared";
import type {
  MigrationStep,
  MigrationResult,
} from "./migration-orchestrator.js";

const LEGACY_WIZARD_DRAFT_KEY = "hexagen-wizard-draft";

export class WizardDraftMigrationStep implements MigrationStep {
  id = "wizard-draft-to-idb";
  description = "Migrate wizard draft from localStorage to IndexedDB";

  private wizardPersistence: WizardPersistencePort;

  constructor(wizardPersistence: WizardPersistencePort) {
    this.wizardPersistence = wizardPersistence;
  }

  async migrate(): Promise<MigrationResult> {
    if (typeof window === "undefined") {
      return { success: true, recordsMigrated: 0, errors: [] };
    }

    const raw = localStorage.getItem(LEGACY_WIZARD_DRAFT_KEY);
    if (!raw) {
      return { success: true, recordsMigrated: 0, errors: [] };
    }

    try {
      const draft = JSON.parse(raw) as WizardDraft;
      if (!draft.id || typeof draft.savedAtStep !== "number") {
        localStorage.removeItem(LEGACY_WIZARD_DRAFT_KEY);
        return { success: true, recordsMigrated: 0, errors: [] };
      }

      const result = await this.wizardPersistence.saveDraft(draft);
      if (!result.success) {
        return {
          success: false,
          recordsMigrated: 0,
          errors: [
            result.error instanceof Error
              ? result.error.message
              : "Failed to save draft to IDB",
          ],
        };
      }

      localStorage.removeItem(LEGACY_WIZARD_DRAFT_KEY);
      return { success: true, recordsMigrated: 1, errors: [] };
    } catch (e) {
      return {
        success: false,
        recordsMigrated: 0,
        errors: [
          e instanceof Error ? e.message : "Failed to parse wizard draft",
        ],
      };
    }
  }

  async verify(): Promise<boolean> {
    if (typeof window === "undefined") return true;

    const legacyExists = localStorage.getItem(LEGACY_WIZARD_DRAFT_KEY) !== null;
    if (legacyExists) return false;

    const loadResult = await this.wizardPersistence.loadDraft();
    return loadResult.success;
  }
}
