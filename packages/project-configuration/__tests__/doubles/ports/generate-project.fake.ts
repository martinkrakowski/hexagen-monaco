// In‑memory fake implementation of the IGenerateProjectPort used for unit tests.
// Allows optional custom behavior for the `execute` method.
// By default, `execute` simply echoes the input unchanged.

import type { IGenerateProjectPort } from "../../../src/application/ports/in/generate-project.port";

/**
 * Fake implementation of `IGenerateProjectPort`.
 *
 * Provides a `setBehavior` method so tests can inject a custom
 * async implementation for `execute`. If no custom behavior is set,
 * the fake simply returns the input unchanged (echo).
 */
export class FakeGenerateProjectPort implements IGenerateProjectPort {
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
  async generate(spec: any): Promise<any> {
    if (this.behavior) {
      return this.behavior(spec);
    }
    // Default happy‑path – echo the input.
    return Promise.resolve(spec);
  }
}
