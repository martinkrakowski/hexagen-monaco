/**
 * The failure channel of {@link LLMClientPort} — owned by the domain, not by any
 * provider adapter (ADR-0053).
 *
 * `LLMError` is provider-neutral by construction: `kind` enumerates the failure
 * modes a caller can act on (retry, re-auth, surface to the user), and nothing
 * here names a vendor, an SDK, or a transport. Infrastructure adapters map their
 * concrete failures (an HTTP status, an AWS SDK exception, a socket timeout)
 * onto this union at the adapter boundary; the domain never sees the provider's
 * error type, and swapping providers cannot change the port's contract.
 */
export type LLMErrorKind =
  | "auth"
  | "rate-limit"
  | "service"
  | "timeout"
  | "parsing"
  | "unknown";

export class LLMError extends Error {
  constructor(
    public readonly kind: LLMErrorKind,
    message: string,
    public readonly cause?: unknown,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/** Retry policy is a property of the failure kind, so it lives with the union. */
export function isRetryable(error: LLMError): boolean {
  return error.kind === "service" || error.kind === "rate-limit";
}
