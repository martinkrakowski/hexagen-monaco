import { ErrorCode, type ErrorLayer } from "../../shared/errors/error-codes";

/**
 * Base class for domain errors — violations of business rules and invariants.
 * Domain errors are expected, named failures; they carry a stable `code` and an
 * optional structured `context` (never raw provider data).
 */
export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  readonly layer: ErrorLayer = "domain";

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    // Restore the subclass prototype: `extends Error` + a downlevel compile
    // target otherwise breaks `instanceof` (which the HTTP handler relies on).
    Object.setPrototypeOf(this, new.target.prototype);
    // Keep the concrete subclass name (e.g. "NotFoundError") on the instance.
    this.name = new.target.name;
  }
}
