import { InfrastructureError } from "./infrastructure.error";
import { ErrorCode } from "../../shared/errors/error-codes";

/** The LLM provider did not respond within the timeout. Maps to HTTP 504. */
export class LLMTimeoutError extends InfrastructureError {
  readonly code = ErrorCode.LLM_TIMEOUT;

  constructor(
    public readonly provider: string,
    public readonly timeoutMs: number,
  ) {
    super("LLM provider '" + provider + "' timed out after " + timeoutMs + "ms", {
      provider,
      timeoutMs,
    });
  }
}

/** The LLM provider rate-limited the request. Maps to HTTP 429. */
export class LLMRateLimitError extends InfrastructureError {
  readonly code = ErrorCode.LLM_RATE_LIMITED;

  constructor(
    public readonly provider: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super("LLM provider '" + provider + "' rate-limited the request", {
      provider,
      retryAfterSeconds,
    });
  }
}

/** The LLM response could not be parsed into the expected shape. Maps to 502. */
export class LLMParsingError extends InfrastructureError {
  readonly code = ErrorCode.LLM_PARSING_FAILED;

  constructor(
    public readonly rawResponse: string,
    public readonly parseError: Error,
  ) {
    super("Failed to parse LLM response: " + parseError.message, {
      parseError: parseError.message,
    });
  }
}

/** Authentication with the LLM provider failed (bad/missing key). Maps to 502. */
export class LLMAuthError extends InfrastructureError {
  readonly code = ErrorCode.LLM_AUTH_FAILED;

  constructor(public readonly provider: string) {
    super("Authentication failed for LLM provider '" + provider + "'", {
      provider,
    });
  }
}
