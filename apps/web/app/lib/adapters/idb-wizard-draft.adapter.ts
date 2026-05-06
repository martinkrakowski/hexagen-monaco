import { get, set, del } from "idb-keyval";
import type {
  Result,
  WizardDraft,
  WizardPersistencePort,
} from "@hexagen/shared";

const WIZARD_DRAFT_PREFIX = "hexagen:wizard-draft:";

export class IDBWizardDraftAdapter implements WizardPersistencePort {
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  setProjectId(projectId: string): void {
    this.projectId = projectId;
  }

  private get key(): string {
    return `${WIZARD_DRAFT_PREFIX}${this.projectId}`;
  }

  async saveDraft(draft: WizardDraft): Promise<Result<WizardDraft, Error>> {
    try {
      const payload: WizardDraft = {
        ...draft,
        updatedAt: Date.now(),
      };
      await set(this.key, payload);
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
      const data = await get<WizardDraft>(this.key);
      if (!data) return { success: true, value: null };

      if (!data.id || typeof data.savedAtStep !== "number") {
        return { success: false, error: new Error("Invalid draft format") };
      }
      return { success: true, value: data };
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
      await del(this.key);
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
