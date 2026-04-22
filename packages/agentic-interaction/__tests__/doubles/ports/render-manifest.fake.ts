// Fake implementation for IRenderManifestPort used in unit tests.
// Implements the same contract as the real port but allows optional custom behavior.

import type { IRenderManifestPort } from "@hexagen/project-configuration";

export class FakeRenderManifestPort implements IRenderManifestPort {
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
