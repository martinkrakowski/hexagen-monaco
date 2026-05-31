// @hexagen-server-only
/**
 * Adobe Firefly error hierarchy + classifier.
 *
 * The HTTP error surface is uniform across Firefly Services, so one classifier
 * maps a failed response onto a typed error. Foundation code throws these;
 * service adapters catch and convert to `Result<T, FireflyError>`. All extend
 * `Error`, satisfying the `Result<T, E extends Error>` contract.
 */
export class FireflyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Whether retrying the same request could succeed (429, 5xx). */
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 401, or 403 that is not an entitlement problem. */
export class FireflyAuthError extends FireflyError {}

/** 403 where the IMS org/credential lacks the service entitlement or scope. */
export class FireflyEntitlementError extends FireflyError {}

/** 429 — throttled. Carries the parsed `Retry-After` when present. */
export class FireflyRateLimitError extends FireflyError {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message, 429, true);
  }
}

/** 4xx other than 401/403/429 — a bad request the caller must fix. */
export class FireflyValidationError extends FireflyError {}

/** 5xx — transient service failure, safe to retry. */
export class FireflyServiceError extends FireflyError {
  constructor(message: string, status = 500) {
    super(message, status, true);
  }
}

export interface AdobeErrorLike {
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly message?: string;
  readonly body?: unknown;
}

/**
 * Map a failed Adobe response (or thrown error) onto a typed `FireflyError`.
 * 401/403→Auth(/Entitlement), 429→RateLimit, other 4xx→Validation, 5xx→Service.
 */
export function classifyAdobeError(error: AdobeErrorLike | unknown): FireflyError {
  if (error instanceof FireflyError) return error;

  const e = (error ?? {}) as AdobeErrorLike;
  const status = typeof e.status === "number" ? e.status : undefined;
  const detail = e.message ?? describe(e.body) ?? "Adobe Firefly request failed";

  if (status === 401) return new FireflyAuthError(`Unauthorized: ${detail}`, 401);
  if (status === 403) {
    return /entitle|not\s*entitled|forbidden scope/i.test(detail)
      ? new FireflyEntitlementError(`Not entitled: ${detail}`, 403)
      : new FireflyAuthError(`Forbidden: ${detail}`, 403);
  }
  if (status === 429) return new FireflyRateLimitError(`Rate limited: ${detail}`, e.retryAfterMs);
  if (status !== undefined && status >= 500) return new FireflyServiceError(`Service error: ${detail}`, status);
  if (status !== undefined && status >= 400) return new FireflyValidationError(`Invalid request: ${detail}`, status);
  return new FireflyServiceError(detail, status ?? 500);
}

function describe(body: unknown): string | undefined {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const msg = b.error_description ?? b.message ?? b.error ?? b.title;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(body).slice(0, 300);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
