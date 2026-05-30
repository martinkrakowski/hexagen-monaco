import { DomainError } from "./domain.error";
import { ErrorCode } from "../../shared/errors/error-codes";

/** No valid credentials / not authenticated. Maps to HTTP 401. */
export class UnauthorizedError extends DomainError {
  readonly code = ErrorCode.UNAUTHORIZED;

  constructor(message = "Authentication is required") {
    super(message);
  }
}

/** Authenticated, but not permitted to perform the action. Maps to HTTP 403. */
export class ForbiddenError extends DomainError {
  readonly code = ErrorCode.FORBIDDEN;

  constructor(action: string, message?: string) {
    super(message ?? "Not permitted to perform: " + action, { action });
  }
}
