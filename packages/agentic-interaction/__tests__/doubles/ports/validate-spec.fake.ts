// Fake implementation for IValidateSpecPort used in unit tests.
// Implements the same contract as the real port but allows optional custom behavior.

import type { IValidateSpecPort } from '../../../src/application/ports/in/validate-spec.port';

export class FakeValidateSpecPort implements IValidateSpecPort {
  private behavior: ((input: any) => Promise<any>) | null = null;

  /** Set a custom implementation for the `execute` method. */
  setBehavior(fn: (input: any) => Promise<any>) {
    this.behavior = fn;
  }

  async execute(input: any): Promise<any> {
    if (this.behavior) {
      return this.behavior(input);
    }
    // Default happy‑path: echo the input unchanged.
    return Promise.resolve(input);
  }
}
