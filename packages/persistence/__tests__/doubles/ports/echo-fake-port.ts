/**
 * Generic in-memory test double shared by the persistence port fakes: `execute`
 * echoes its input unchanged by default, or applies a custom async
 * implementation registered via `setBehavior`. Subclassed per port so the tests
 * read with a port-specific name.
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
