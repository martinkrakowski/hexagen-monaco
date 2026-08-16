/**
 * The failure channel of the creative-service out-ports — owned by the domain,
 * not by any vendor adapter (ADR-0053).
 *
 * `kind` enumerates the failure modes a caller can act on (re-authenticate, ask
 * for an entitlement, back off, fix the request, retry). Nothing here names a
 * vendor, an SDK or a transport, so a port typed with this union can be
 * satisfied by any implementation — the shipped adapters, a different creative
 * service, or a test double — and the concrete, server-only vendor error
 * classes never cross into the domain or into a client bundle.
 *
 * Adapters map their own failures onto this union at their boundary (see
 * `toCreativeServiceError()` in the infrastructure layer).
 */
export type CreativeServiceErrorKind =
  /** Credentials rejected or missing. */
  | "auth"
  /** Authenticated, but the org/credential lacks the service entitlement. */
  | "entitlement"
  /** Throttled; `retryAfterMs` carries the service's hint when it gave one. */
  | "rate-limited"
  /** The request itself is wrong — retrying it unchanged cannot help. */
  | "invalid-request"
  /** Upstream failure; safe to retry. */
  | "service"
  /** Unclassifiable. */
  | "unknown";

export interface CreativeServiceErrorOptions {
  /** Upstream status code, when the failure came from an HTTP boundary. */
  readonly status?: number;
  /** Overrides the default retryability implied by `kind`. */
  readonly retryable?: boolean;
  /** Backoff hint in milliseconds (rate-limited responses). */
  readonly retryAfterMs?: number;
}

/** Kinds a caller may retry unchanged, absent an explicit override. */
const RETRYABLE_KINDS: ReadonlySet<CreativeServiceErrorKind> = new Set([
  "rate-limited",
  "service",
]);

export class CreativeServiceError extends Error {
  readonly kind: CreativeServiceErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    kind: CreativeServiceErrorKind,
    message: string,
    options: CreativeServiceErrorOptions = {},
  ) {
    super(message);
    this.name = "CreativeServiceError";
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? RETRYABLE_KINDS.has(kind);
    this.retryAfterMs = options.retryAfterMs;
  }
}
