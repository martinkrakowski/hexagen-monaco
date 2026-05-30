import { ErrorCode, type ErrorLayer } from "../../shared/errors/error-codes";

/**
 * Base class for infrastructure errors — failures of I/O and third-party
 * systems (HTTP, DB, storage, LLM providers). These should be wrapped at the
 * application boundary rather than bubbling up as domain errors.
 */
export abstract class InfrastructureError extends Error {
  abstract readonly code: ErrorCode;
  readonly layer: ErrorLayer = "infrastructure";

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    // Restore the subclass prototype so `instanceof` works under any compile
    // target (the HTTP handler discriminates errors via instanceof).
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}
