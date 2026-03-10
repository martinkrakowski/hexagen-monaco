// In‑memory fake implementation of the IGenerateProjectPort used for unit tests.
// Allows optional custom behavior for the `generate` method.
// By default, `generate` simply echoes the input unchanged.

import type { IGenerateProjectPort } from "../../../src/application/ports/in/generate-project.port";

/**
 * Fake implementation of `IGenerateProjectPort`.
 * Provides a `setBehavior` method so tests can inject a custom
 * async implementation for `generate`. If no custom behavior is set,
 * the fake simply returns the input unchanged (echo).
 */
export class FakeGenerateProjectPort implements IGenerateProjectPort {
  private behavior: ((spec: any) => Promise<any>) | null = null;

  /** Register a custom implementation for the `generate` method. */
  setBehavior(fn: (spec: any) => Promise<any>) {
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

  // Alias for compatibility with tests expecting `execute`
  async execute(spec: any): Promise<any> {
    return this.generate(spec);
  }
}
