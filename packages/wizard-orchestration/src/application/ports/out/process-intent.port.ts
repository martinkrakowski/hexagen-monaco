/**
 * Driven (outbound) port — ADR-0048.
 *
 * `ProcessIntentUseCase` depends on this contract and calls it; an
 * infrastructure adapter (AI engine, rule engine, state machine, …) supplies
 * the implementation. That is the outbound direction, so it lives in
 * `application/ports/out`.
 */
export interface ProcessIntentPort {
  /** Processes an incoming intent (user or agent). */
  process(data: unknown): Promise<unknown>;
}
