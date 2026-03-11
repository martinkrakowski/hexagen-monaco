import type { RenderManifestPort } from '../../../src/application/ports/in/render-manifest.port';

/**
 * In‑memory fake for `RenderManifestPort`.
 * Allows tests to optionally provide a custom implementation for `execute`.
 * Default behavior simply echoes the input unchanged.
 */
export class FakeRenderManifestPort implements RenderManifestPort {
  private behavior: ((input: any) => Promise<any>) | null = null;

  /** Register a custom async implementation for the `execute` method. */
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
