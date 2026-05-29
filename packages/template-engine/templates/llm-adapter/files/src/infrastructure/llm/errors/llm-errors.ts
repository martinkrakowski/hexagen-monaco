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

export class LLMAuthError extends LLMError {
  constructor(message = "LLM authentication failed — check your API key") {
    super("auth", message);
    this.name = "LLMAuthError";
  }
}

export class LLMRateLimitError extends LLMError {
  constructor(retryAfterMs?: number) {
    super(
      "rate-limit",
      "LLM rate limit exceeded",
      undefined,
      retryAfterMs,
    );
    this.name = "LLMRateLimitError";
  }
}

export class LLMServiceError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super("service", message, cause);
    this.name = "LLMServiceError";
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(timeoutMs: number) {
    super("timeout", `LLM request timed out after ${timeoutMs}ms`);
    this.name = "LLMTimeoutError";
  }
}

export class LLMParsingError extends LLMError {
  constructor(
    message: string,
    public readonly raw: string,
    cause?: unknown,
  ) {
    super("parsing", message, cause);
    this.name = "LLMParsingError";
  }
}

export function classifyHttpError(status: number, retryAfterHeader?: string | null): LLMError {
  const retryAfterMs = retryAfterHeader
    ? (() => {
        const seconds = Number.parseInt(retryAfterHeader, 10);
        if (Number.isFinite(seconds)) return seconds * 1000;
        const dateMs = Date.parse(retryAfterHeader);
        return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
      })()
    : undefined;

  if (status === 401 || status === 403) return new LLMAuthError();
  if (status === 429) return new LLMRateLimitError(retryAfterMs);
  if (status >= 500) return new LLMServiceError(`LLM service error (HTTP ${status})`);
  return new LLMError("unknown", `Unexpected LLM HTTP status: ${status}`);
}

export function isRetryable(error: LLMError): boolean {
  return error.kind === "service" || error.kind === "rate-limit";
}
