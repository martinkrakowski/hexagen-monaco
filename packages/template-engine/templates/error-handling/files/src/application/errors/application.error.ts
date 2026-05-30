import { ErrorCode, type ErrorLayer } from "../../shared/errors/error-codes";

/**
 * Base class for application-layer errors. The application layer orchestrates
 * use cases; when a lower layer fails in a way the use case can't recover from,
 * wrap the original error as the `cause` so the boundary keeps the full chain
 * without leaking lower-layer types upward.
 */
export abstract class ApplicationError extends Error {
  abstract readonly code: ErrorCode;
  readonly layer: ErrorLayer = "application";

  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    // Restore the subclass prototype so `instanceof` works under any compile
    // target (the HTTP handler discriminates errors via instanceof).
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

/** Generic wrapper for a use case that failed for an underlying reason. */
export class UseCaseError extends ApplicationError {
  readonly code = ErrorCode.USE_CASE_FAILED;

  constructor(useCase: string, cause?: Error) {
    super("Use case '" + useCase + "' failed", cause, { useCase });
  }
}
