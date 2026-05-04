// In‑memory fake implementation of the IRenderManifestPort for unit tests in the `architectural-enforcement` package.

import type { IRenderManifestPort } from "@hexagen/project-configuration";

/**
 * Type for render manifest request
 */
export interface RenderManifestRequest {
  template: string;
  context?: Record<string, unknown>;
}

/**
 * Type for render manifest response
 */
export interface RenderManifestResponse {
  success: boolean;
  manifest?: string;
  error?: string;
}

/**
 * Fake implementation of `IRenderManifestPort`.
 *
 * Provides a `setBehavior` method so tests can inject a custom async
 * implementation for `execute`. If no custom behavior is set, the fake
 * simply returns the input unchanged (echo).
 */
export class FakeRenderManifestPort implements IRenderManifestPort {
  private behavior:
    | ((input: RenderManifestRequest) => Promise<RenderManifestResponse>)
    | null = null;

  /**
   * Register a custom async implementation for the `execute` method.
   *
   * @param fn - Async function that receives the input and returns a result.
   */
  setBehavior(
    fn: (input: RenderManifestRequest) => Promise<RenderManifestResponse>,
  ) {
    this.behavior = fn;
  }

  /** Execute the port – either the custom behavior or a default echo. */
  async execute(input: RenderManifestRequest): Promise<RenderManifestResponse> {
    if (this.behavior) {
      return this.behavior(input);
    }
    // Default happy‑path – echo the input.
    return Promise.resolve({
      success: true,
      manifest: input.template,
    });
  }
}
