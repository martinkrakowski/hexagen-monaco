// hexagen-monaco/packages/code-generation/__tests__/doubles/ports/generate-project.fake.ts
// In‑memory fake for the IGenerateProjectPort used in unit tests.
// Allows optional custom behavior for the `execute` method.
// If no behavior is set, the fake simply returns the input unchanged.

import type { IGenerateProjectPort } from '../../../src/application/ports/in/generate-project.port';

export class FakeGenerateProjectPort implements IGenerateProjectPort {
  private behavior: ((input: any) => Promise<any>) | null = null;

  /** Set a custom implementation for the `execute` method. */
  setBehavior(fn: (input: any) => Promise<any>) {
    this.behavior = fn;
  }

  async execute(input: any): Promise<any> {
    if (this.behavior) {
      return this.behavior(input);
    }
    // Default behaviour – echo the input.
    return Promise.resolve(input);
  }
}
