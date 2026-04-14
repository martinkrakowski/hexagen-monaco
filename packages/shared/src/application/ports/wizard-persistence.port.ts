import type { Result } from "../../errors/result.js";

/**
 * Port defining persistence operations for wizard draft state.
 * Implemented by infrastructure adapters (e.g. LocalStoragePersistenceAdapter).
 *
 * Follows hexagonal rules: port is pure, no dependencies on concrete storage.
 *
 * Part of the shared kernel — imported by wizard-orchestration and web-driver.
 */
export interface WizardDraft {
  readonly id: string;
  readonly savedAtStep: number;
  readonly formState: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WizardPersistencePort {
  saveDraft(draft: WizardDraft): Promise<Result<WizardDraft, Error>>;
  loadDraft(): Promise<Result<WizardDraft | null, Error>>;
  clearDraft(): Promise<Result<void, Error>>;
}
