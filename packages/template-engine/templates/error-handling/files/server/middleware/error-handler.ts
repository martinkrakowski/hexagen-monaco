// HTTP error mapping (strategy: {http_mapping}).
//
// Translates a thrown/returned error into an HTTP status + RFC 7807 Problem
// Details body. Framework-agnostic: it returns { status, body } so you can use
// it from a Next.js route handler:
//
//   const { status, body } = handleError(err, req.nextUrl.pathname);
//   return Response.json(body, { status });
//
// ...or wrap it as Express middleware:
//
//   app.use((err, req, res, _next) => {
//     const { status, body } = handleError(err, req.originalUrl);
//     res.status(status).json(body);
//   });
import { ErrorCode } from "../../src/shared/errors/error-codes";
import { DomainError } from "../../src/domain/errors/domain.error";
import { ApplicationError } from "../../src/application/errors/application.error";
import { InfrastructureError } from "../../src/infrastructure/errors/infrastructure.error";

/** RFC 7807 Problem Details. Extra members (e.g. `fields`) are allowed. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  [key: string]: unknown;
}

const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.VALIDATION_FAILED]: 422,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.USE_CASE_FAILED]: 500,
  [ErrorCode.EXTERNAL_SERVICE_FAILED]: 502,
  [ErrorCode.LLM_TIMEOUT]: 504,
  [ErrorCode.LLM_RATE_LIMITED]: 429,
  [ErrorCode.LLM_PARSING_FAILED]: 502,
  [ErrorCode.LLM_AUTH_FAILED]: 502,
  [ErrorCode.INTERNAL]: 500,
};

const TYPE_BASE_URL = "https://errors.example.com/";

// Set by the error-handling wizard via the `sentry` answer.
const SENTRY_ENABLED = "{sentry}" === "true";

type TypedError = DomainError | ApplicationError | InfrastructureError;

function isTypedError(error: unknown): error is TypedError {
  return (
    error instanceof DomainError ||
    error instanceof ApplicationError ||
    error instanceof InfrastructureError
  );
}

export interface HttpError {
  status: number;
  body: ProblemDetails;
}

export function handleError(error: unknown, instance?: string): HttpError {
  if (isTypedError(error)) {
    const status = HTTP_STATUS_BY_CODE[error.code] ?? 500;
    const body: ProblemDetails = {
      type: TYPE_BASE_URL + error.code,
      title: error.name,
      status,
      detail: error.message,
      code: error.code,
      ...(instance ? { instance } : {}),
      ...(error.context ?? {}),
    };
    return { status, body };
  }

  // Unknown error — log it, report it, and never leak internals to the client.
  console.error("Unhandled error:", error);
  if (SENTRY_ENABLED) void reportToSentry(error);

  return {
    status: 500,
    body: {
      type: TYPE_BASE_URL + ErrorCode.INTERNAL,
      title: "Internal Server Error",
      status: 500,
      detail: "An unexpected error occurred.",
      code: ErrorCode.INTERNAL,
      ...(instance ? { instance } : {}),
    },
  };
}

// Lazily and optionally report to Sentry. @sentry/node is an optional peer; if
// it isn't installed this becomes a no-op after the first attempt. The specifier
// is indirected so a project without Sentry still typechecks.
let sentryModule: { captureException: (e: unknown) => void } | null | undefined;

async function reportToSentry(error: unknown): Promise<void> {
  if (sentryModule === null) return;
  try {
    if (sentryModule === undefined) {
      const moduleName: string = "@sentry/node";
      sentryModule = (await import(moduleName)) as {
        captureException: (e: unknown) => void;
      };
    }
    sentryModule.captureException(error);
  } catch {
    sentryModule = null;
  }
}
