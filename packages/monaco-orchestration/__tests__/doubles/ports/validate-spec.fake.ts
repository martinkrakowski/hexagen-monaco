import type { IValidateSpecPort } from '../../../src/application/ports/in/validate-spec.port';

/**
 * In‑memory fake implementation of `IValidateSpecPort` for unit tests.
 *
 * The fake mirrors the real port contract and allows optional custom behavior via
 * `setBehavior`. If no custom behavior is provided, the `execute` method simply
 * echoes the input unchanged.
 */
export class FakeValidateSpecPort implements IValidateSpecPort {
  private behavior: ((input: any) => Promise<any>) | null = null;

  /**
   * Register a custom async implementation for the `execute` method.
   *
   * @param fn - Async function that receives the input and returns a result.
   */
  setBehavior(fn: (input: any) => Promise<any>) {
    this.behavior = fn;
  }

  /** Execute the port – either the custom behavior or a default echo. */
  async execute(input: any): Promise<any> {
    if (this.behavior) {
      return this.behavior(input);
    }
    // Default happy‑path – echo the input.
    return Promise.resolve(input);
  }
}
