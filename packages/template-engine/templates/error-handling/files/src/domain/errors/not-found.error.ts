import { DomainError } from "./domain.error";
import { ErrorCode } from "../../shared/errors/error-codes";

/** A requested resource does not exist. Maps to HTTP 404. */
export class NotFoundError extends DomainError {
  readonly code = ErrorCode.NOT_FOUND;

  constructor(resource: string, id: string) {
    super(resource + " with id '" + id + "' was not found", { resource, id });
  }
}
