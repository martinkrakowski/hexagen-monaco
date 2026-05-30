import { DomainError } from "./domain.error";
import { ErrorCode } from "../../shared/errors/error-codes";

/**
 * Input failed validation. `fields` maps each invalid field to its messages, so
 * the HTTP layer (and the UI) can surface per-field feedback. Maps to HTTP 422.
 */
export class ValidationError extends DomainError {
  readonly code = ErrorCode.VALIDATION_FAILED;

  constructor(
    message: string,
    public readonly fields: Record<string, string[]> = {},
  ) {
    super(message, { fields });
  }
}
