// hexagen-monaco/packages/code-generation/__tests__/doubles/ports/validate-spec.fake.ts
// In‑memory fake implementation of the IValidateSpecPort used for unit tests.
// Allows optional custom behavior for the `execute` method.
// By default, `execute` echoes the input unchanged.

import type { IValidateSpecPort } from '../../../src/application/ports/in/validate-spec.port';

/**
 * Fake implementation of `IValidateSpecPort`.
 *
 * Provides a `setBehavior` method so tests can inject a custom async
 * implementation for `execute`. If no custom behavior is set, the fake
 * simply returns the input unchanged (echo).
 */
export class FakeValidateSpecPort implements IValidateSpecPort {
  private behavior: ((input: any) => Promise<any>) | null = null;

  /**
   * Register a custom implementation for the `execute` method.
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
