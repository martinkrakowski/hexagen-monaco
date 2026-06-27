/**
 * Test-only utilities for `@hexagen/shared`.
 *
 * Exposed under the dedicated `@hexagen/shared/testing` subpath (NOT the main
 * `@hexagen/shared` barrel) so these doubles never leak into runtime/production
 * imports. Consume from test code only:
 *
 * ```ts
 * import { EchoFakePort } from "@hexagen/shared/testing";
 * ```
 */

/**
 * Generic in-memory test double for hexagonal port fakes: `execute` echoes its
 * input unchanged by default, or applies a custom async implementation
 * registered via `setBehavior`. Subclass it per port so the tests read with a
 * port-specific name:
 *
 * ```ts
 * export class FakeRenderManifestPort extends EchoFakePort {}
 * ```
 *
 * Previously this 12-line class was copied verbatim into every package's
 * `__tests__/doubles/ports/echo-fake-port.ts`; co-located here to remove the
 * duplication (the 6 copies differed only in a JSDoc package name).
 */
export class EchoFakePort {
  private behavior: ((input: unknown) => Promise<unknown>) | null = null;

  /** Register a custom async implementation for `execute`. */
  setBehavior(fn: (input: unknown) => Promise<unknown>): void {
    this.behavior = fn;
  }

  /** Apply the registered behavior, or echo the input unchanged by default. */
  async execute(input: unknown): Promise<unknown> {
    return this.behavior ? this.behavior(input) : input;
  }
}
