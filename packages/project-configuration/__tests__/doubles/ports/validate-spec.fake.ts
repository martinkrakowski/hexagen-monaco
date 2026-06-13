import type { ValidateSpecPort } from "../../../src/application/ports/in/validate-spec.port";
import type {
  ValidateSpecRequest,
  ValidateSpecResponse,
} from "../../../src/application/ports/in/validate-spec.port";

/**
 * In‑memory fake for `ValidateSpecPort`.
 * Allows tests to optionally provide a custom implementation for `execute`.
 * Default behavior returns a successful validation response.
 */
export class FakeValidateSpecPort implements ValidateSpecPort {
  private behavior:
    | ((input: ValidateSpecRequest) => Promise<ValidateSpecResponse>)
    | null = null;

  /**
   * Register a custom async implementation for the `execute` method.
   *
   * @param fn - Async function that receives the input and returns a result.
   */
  setBehavior(
    fn: (input: ValidateSpecRequest) => Promise<ValidateSpecResponse>,
  ) {
    this.behavior = fn;
  }

  /** Execute the port – either the custom behavior or a default echo. */
  async execute(input: ValidateSpecRequest): Promise<ValidateSpecResponse> {
    if (this.behavior) {
      return this.behavior(input);
    }
    // Default happy‑path – validation success.
    return Promise.resolve({ success: true });
  }
}
