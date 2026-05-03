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
 * In‑memory fake for `IValidateSpecPort`.
 * Allows optional custom behavior; defaults to echo input.
 */
export class FakeValidateSpecPort implements IValidateSpecPort {
  private behavior:
    | ((input: ValidateSpecRequest) => Promise<ValidateSpecResponse>)
    | null = null;

  /** Set a custom implementation for the `execute` method. */
  setBehavior(fn: (input: ValidateSpecRequest) => Promise<ValidateSpecResponse>) {
    this.behavior = fn;
  }

  async execute(input: ValidateSpecRequest): Promise<ValidateSpecResponse> {
    if (this.behavior) {
      return this.behavior(input);
    }
    // Default happy‑path – validation success.
    return Promise.resolve({ success: true });
  }
}
