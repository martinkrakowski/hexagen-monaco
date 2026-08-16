/**
 * Driven (outbound) port — ADR-0048.
 *
 * `ValidateStepUseCase` depends on this contract and calls it; an
 * infrastructure adapter (schema validator, business-rules engine, …) supplies
 * the implementation. That is the outbound direction, so it lives in
 * `application/ports/out`.
 */
export interface ValidateStepPort {
  /** Validates the current wizard step against domain rules and invariants. */
  validate(data: unknown): Promise<unknown>;
}
