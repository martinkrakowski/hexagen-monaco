// hexagen-monaco/packages/code-generation/__tests__/doubles/ports/render-manifest.fake.ts
// In‑memory fake implementation of the IRenderManifestPort used for unit tests.
// The fake mirrors the real port contract and allows optional custom behavior
// for the `execute` method. If no custom behavior is supplied, the fake simply
// returns the input unchanged (echo).

import type { IRenderManifestPort } from '../../../src/application/ports/in/render-manifest.port';

/**
 * Fake implementation of `IRenderManifestPort`.
 *
 * * `setBehavior` lets a test provide a custom async implementation.
 * * By default, `execute` returns the supplied input unchanged.
 */
export class FakeRenderManifestPort implements IRenderManifestPort {
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
