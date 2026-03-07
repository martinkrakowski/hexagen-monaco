export interface IValidateStepPort {
  /**
   * Validates the current wizard step against domain rules and invariants.
   * Infrastructure adapters (schema validator, business rules engine, etc.)
   * implement this contract.
   */
  validate(data: unknown): Promise<unknown>;
}
