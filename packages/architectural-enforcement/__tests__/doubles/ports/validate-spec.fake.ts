import type { IValidateSpecPort } from '../../../src/application/ports/in/validate-spec.port';

/**
 * In‑memory fake for `IValidateSpecPort`.
 * Allows optional custom behavior; defaults to echo input.
 */
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
    // Default happy‑path – echo the input.
    return Promise.resolve(input);
  }
}
