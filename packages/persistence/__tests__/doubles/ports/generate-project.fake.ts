// Fake implementation for IGenerateProjectPort used in unit tests.
import type { IGenerateProjectPort } from '../../../src/application/ports/in/generate-project.port';

/** In‑memory fake for `IGenerateProjectPort`.
 *
 * Allows tests to optionally provide a custom implementation for `execute`.
 * By default, `execute` returns the input unchanged.
 */
export class FakeGenerateProjectPort implements IGenerateProjectPort {
  private behavior: ((input: any) => Promise<any>) | null = null;

  /** Register a custom async implementation for the `execute` method. */
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
