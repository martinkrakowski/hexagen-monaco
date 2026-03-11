

import { ApplySemanticPatchPort } from "../../../src/application/ports/in/apply-semantic-patch.port";
/**
 * In‑memory fake for `ApplySemanticPatchPort`.
 *
 * Allows tests to inject custom behavior for the `apply` method.
 * If no behavior is set, the fake simply returns the input data.
 */

export class FakeSemanticPatchPort implements ApplySemanticPatchPort {
  private behavior: ((data: unknown) => Promise<unknown>) | null = null;

  /** Set a custom implementation for the `apply` method. */
  setBehavior(fn: (data: unknown) => Promise<unknown>) {
    this.behavior = fn;
  }

  async apply(data: unknown): Promise<unknown> {
    if (this.behavior) {
      return this.behavior(data);
    }
    // Default happy‑path: echo the input.
    return data;
  }
}
