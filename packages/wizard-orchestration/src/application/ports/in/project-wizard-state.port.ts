export interface IProjectWizardStatePort {
  /**
   * Retrieves the current state of the project wizard based on input data.
   * Infrastructure adapters (state machine, persistence, session store, etc.)
   * implement this contract.
   */
  getCurrentState(data: unknown): Promise<unknown>;
}
