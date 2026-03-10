// Fake implementation of the IGenerateProjectPort for unit tests in the project-generation package.
import type { IGenerateProjectPort } from '../../../src/application/ports/in/generate-project.port';

/**
 * In-memory fake for `IGenerateProjectPort`.
 *
 * Allows tests to optionally provide a custom async implementation for `execute`.
 * If no custom behavior is provided, the fake simply returns the input unchanged (echo).
 */
export class FakeGenerateProjectPort implements IGenerateProjectPort {
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
    // Default happy-path – echo the input.
    return Promise.resolve(input);
  }
}
