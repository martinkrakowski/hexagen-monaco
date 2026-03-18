/**
 * Port for the wizard controller – used by the UI layer to drive navigation
 * and active context selection. Implementations are provided by the UI
 * (React) and can be replaced by test doubles.
 */
export interface IProjectWizardController {
  /** Navigate to a specific wizard step (0‑based index). */
  navigateToStep(stepIndex: number): void;
  /** Set the currently active bounded context by its id. */
  setActiveContextId(contextId: string): void;
}
