/**
 * Driven (outbound) port — ADR-0048.
 *
 * `ProjectWizardStateUseCase` depends on this contract and calls it; an
 * infrastructure adapter (state machine, persistence, session store, …)
 * supplies the implementation. That is the outbound direction, so it lives in
 * `application/ports/out`.
 */
export interface ProjectWizardStatePort {
  /** Retrieves the current state of the project wizard based on input data. */
  getCurrentState(data: unknown): Promise<unknown>;
}
