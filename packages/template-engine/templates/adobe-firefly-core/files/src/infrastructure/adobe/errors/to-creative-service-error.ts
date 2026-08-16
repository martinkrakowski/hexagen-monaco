// @hexagen-server-only
import {
  CreativeServiceError,
  type CreativeServiceErrorKind,
} from "../../../domain/errors/creative-service-error";
import {
  classifyAdobeError,
  FireflyAuthError,
  FireflyEntitlementError,
  FireflyError,
  FireflyRateLimitError,
  FireflyServiceError,
  FireflyValidationError,
} from "./firefly-errors";

/**
 * The adapter-boundary mapping required by ADR-0053: a concrete, server-only
 * `FireflyError` in, a domain `CreativeServiceError` out.
 *
 * Adapters call this in their `catch` so the vendor error hierarchy stops at the
 * infrastructure layer and the port's `Result<T, CreativeServiceError>` contract
 * stays provider-neutral. Anything unrecognised is classified first, so a raw
 * thrown value (a fetch failure, a timeout) still arrives typed.
 */
export function toCreativeServiceError(error: unknown): CreativeServiceError {
  if (error instanceof CreativeServiceError) return error;
  const classified = classifyAdobeError(error);
  return new CreativeServiceError(kindOf(classified), classified.message, {
    status: classified.status,
    retryable: classified.retryable,
    retryAfterMs:
      classified instanceof FireflyRateLimitError
        ? classified.retryAfterMs
        : undefined,
  });
}

function kindOf(error: FireflyError): CreativeServiceErrorKind {
  if (error instanceof FireflyEntitlementError) return "entitlement";
  if (error instanceof FireflyAuthError) return "auth";
  if (error instanceof FireflyRateLimitError) return "rate-limited";
  if (error instanceof FireflyValidationError) return "invalid-request";
  if (error instanceof FireflyServiceError) return "service";
  return "unknown";
}
