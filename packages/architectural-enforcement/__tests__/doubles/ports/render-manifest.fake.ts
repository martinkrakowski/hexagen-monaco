/**
 * In-memory generic test double used by the architectural-enforcement unit
 * tests. By default `execute` echoes its input unchanged; `setBehavior`
 * registers a custom async implementation.
 */
export class FakeRenderManifestPort {
  private behavior: ((input: unknown) => Promise<unknown>) | null = null;

  /** Register a custom async implementation for `execute`. */
  setBehavior(fn: (input: unknown) => Promise<unknown>): void {
    this.behavior = fn;
  }

  /** Apply the registered behavior, or echo the input unchanged by default. */
  async execute(input: unknown): Promise<unknown> {
    return this.behavior ? this.behavior(input) : input;
  }
}
