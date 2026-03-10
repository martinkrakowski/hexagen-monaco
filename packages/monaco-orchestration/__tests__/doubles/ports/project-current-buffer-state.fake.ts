import type { IProjectCurrentBufferStatePort } from "../../../src/application/ports/in/project-current-buffer-state.port";

/**
 * In‑memory fake for `IProjectCurrentBufferStatePort` used in unit tests.
 * Allows tests to set custom behavior for the `getCurrentState` method.
 * If no custom behavior is supplied, the fake simply echoes the input.
 */
export class FakeProjectCurrentBufferStatePort implements IProjectCurrentBufferStatePort {
  private behavior: ((data: unknown) => Promise<unknown>) | null = null;

  /** Set a custom implementation for the `getCurrentState` method. */
  setBehavior(fn: (data: unknown) => Promise<unknown>) {
    this.behavior = fn;
  }

  async getCurrentState(data: unknown): Promise<unknown> {
    if (this.behavior) {
      return this.behavior(data);
    }
    // Default happy‑path: echo the input.
    return Promise.resolve(data);
  }
}
