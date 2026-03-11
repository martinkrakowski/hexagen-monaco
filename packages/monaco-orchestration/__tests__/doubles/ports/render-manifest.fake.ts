import type { IRenderManifestPort } from '@hexagen/project-configuration';

/**
 * In‑memory fake implementation of `IRenderManifestPort`.
 *
 * Allows tests to optionally provide a custom async implementation for `execute`.
 * By default, `execute` simply returns the input unchanged (echo).
 */
export class FakeRenderManifestPort implements IRenderManifestPort {
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
