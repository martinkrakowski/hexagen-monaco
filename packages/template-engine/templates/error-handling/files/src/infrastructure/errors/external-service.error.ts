import { InfrastructureError } from "./infrastructure.error";
import { ErrorCode } from "../../shared/errors/error-codes";

/**
 * A third-party / upstream service failed. Captures the service name and its
 * HTTP status (when known) without leaking the raw provider payload. Maps to
 * HTTP 502.
 */
export class ExternalServiceError extends InfrastructureError {
  readonly code = ErrorCode.EXTERNAL_SERVICE_FAILED;

  constructor(
    public readonly service: string,
    public readonly statusCode?: number,
    message?: string,
    context?: Record<string, unknown>,
  ) {
    super(message ?? "External service '" + service + "' failed", {
      service,
      statusCode,
      ...context,
    });
  }
}
