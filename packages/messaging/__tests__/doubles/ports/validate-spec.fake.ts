// In‑memory fake implementation of the IValidateSpecPort for the `deployment` package.
// Allows optional custom behavior for the `execute` method.
// By default, `execute` simply echoes the input unchanged.

import type { IValidateSpecPort } from "@hexagen/project-configuration";

/**
 * Type for validate spec request
 */
export interface ValidateSpecRequest {
  spec: Record<string, unknown>;
}

/**
 * Type for validate spec response
 */
export interface ValidateSpecResponse {
  success: boolean;
  errors?: string[];
}

/**
 * Fake implementation of `IValidateSpecPort`.
 *
 * Provides a `setBehavior` method so tests can inject a custom async
 * implementation for `execute`. If no custom behavior is set, the fake
 * simply returns the input unchanged (echo).
 */
export class FakeValidateSpecPort implements IValidateSpecPort {
  private behavior:
    | ((input: ValidateSpecRequest) => Promise<ValidateSpecResponse>)
    | null = null;

  /**
   * Register a custom implementation for the `execute` method.
   *
   * @param fn - Async function that receives the input and returns a result.
   */
  setBehavior(fn: (input: ValidateSpecRequest) => Promise<ValidateSpecResponse>) {
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
