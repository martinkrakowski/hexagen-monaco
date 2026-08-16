import { LLMError } from "../../../domain/errors/llm-error";
import {
  LLMAuthError,
  LLMRateLimitError,
  LLMServiceError,
} from "./llm-errors";

/**
 * Map `@aws-sdk/client-bedrock-runtime` exceptions onto the LLM error hierarchy.
 * AWS SDK errors carry a `name` matching the modeled exception. Retryability
 * follows `isRetryable` (service / rate-limit are retried by `withRetry`).
 */
export function classifyAwsError(error: unknown): LLMError {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  switch (name) {
    case "ThrottlingException":
    case "TooManyRequestsException":
      return new LLMRateLimitError();

    case "AccessDeniedException":
    case "UnauthorizedException":
      return new LLMAuthError(
        "Bedrock access denied — check IAM permissions and that model access is enabled for the region",
      );

    case "ValidationException":
      // Bad request (unsupported model/params) — retrying won't help, so map to
      // a non-retryable kind rather than the retryable `service`.
      return new LLMError("unknown", `Bedrock validation error: ${message}`, error);

    case "ModelTimeoutException":
    case "ModelNotReadyException":
    case "InternalServerException":
    case "ServiceUnavailableException":
      return new LLMServiceError("Bedrock service error", error);

    default:
      return new LLMServiceError("Bedrock request failed", error);
  }
}
