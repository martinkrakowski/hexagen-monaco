# Template: Error Handling

**Branch:** `feature/generator-template-error-handling`

## Purpose

Generates a layered error hierarchy (domain, application, infrastructure), consistent HTTP error mapping, LLM-specific error classes, a global error handler middleware, and a React error boundary. Eliminates the pattern where every route does `try { } catch (e: any) { res.status(500).json({ error: e.message }) }` and replaces it with typed, composable errors.

---

## Install-Time Questions

| ID               | Prompt                                  | Type    | Options                                          | Default                |
| ---------------- | --------------------------------------- | ------- | ------------------------------------------------ | ---------------------- |
| `error_style`    | Error representation style?             | select  | `class-hierarchy`, `result-type`, `both`         | `both`                 |
| `http_mapping`   | HTTP error mapping strategy?            | select  | `status-codes`, `rfc7807-problem-json`, `custom` | `rfc7807-problem-json` |
| `sentry`         | Integrate Sentry for error tracking?    | boolean | —                                                | `false`                |
| `react_boundary` | Generate React ErrorBoundary component? | boolean | —                                                | `true`                 |

---

## Files Generated

```
src/
  domain/
    errors/
      domain.error.ts             # Base domain error
      not-found.error.ts          # Resource not found
      validation.error.ts         # Input validation failure
      authorization.error.ts      # Permission denied
      conflict.error.ts           # State conflict (duplicate, version mismatch)

  application/
    errors/
      application.error.ts        # Base application-layer error
      use-case-failed.error.ts    # Generic use case failure wrapper

  infrastructure/
    errors/
      infrastructure.error.ts     # Base infra error
      external-service.error.ts   # Third-party API failure
      llm-errors.ts               # LLM-specific errors (timeout, parsing, rate-limit)
      database.error.ts           # DB connection/query errors
      storage.error.ts            # File storage errors

  shared/
    result.ts                     # Result<T, E> type
    errors/
      error-codes.ts              # Centralised error code enum
      index.ts

server/
  middleware/
    error-handler.ts              # Global HTTP error handler

app/
  components/
    ErrorBoundary.tsx             # React error boundary (if react_boundary=true)
    ErrorFallback.tsx
```

---

## Key Design Decisions

**Three-layer hierarchy:** `DomainError` → `ApplicationError` → `InfrastructureError`. Each layer can reference errors from lower layers but not higher. A database error never bubbles as a domain error directly — it's wrapped at the application boundary.

**`Result<T, E>` type for expected failures:** Functions that can fail in predictable ways return `Result<T, E>` (not throw). Functions that fail unexpectedly (programming errors, missing config) throw. This distinction is explicit and consistent.

**RFC 7807 Problem+JSON for HTTP errors:** Standardised response format with `type`, `title`, `status`, `detail`, and optional `instance`. Clients can parse errors reliably without guessing field names.

**Error codes are centralised:** `error-codes.ts` is the single place where error code strings live. No magic strings scattered across handlers. This makes i18n and front-end error message customisation straightforward.

**Sentry integration is additive:** When `sentry=true`, the error handler middleware sends uncaught errors to Sentry before responding. Application code never imports Sentry directly.

---

## Phase 1 — Result Type

**Goal:** A `Result<T, E>` type used consistently across all layers.

```typescript
// src/shared/result.ts
export type Result<T, E extends Error = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { success: true, value };
}

export function err<E extends Error>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isOk<T, E extends Error>(
  result: Result<T, E>,
): result is { success: true; value: T } {
  return result.success;
}
```

Validation: Unit test for `ok()`, `err()`, and `isOk()`.

---

## Phase 2 — Domain Error Hierarchy

**Goal:** Typed, composable domain errors with error codes.

```typescript
// src/domain/errors/domain.error.ts
export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  readonly layer = "domain" as const;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// src/domain/errors/not-found.error.ts
export class NotFoundError extends DomainError {
  readonly code = ErrorCode.NOT_FOUND;
  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' was not found`, { resource, id });
  }
}

// src/domain/errors/validation.error.ts
export class ValidationError extends DomainError {
  readonly code = ErrorCode.VALIDATION_FAILED;
  constructor(
    message: string,
    public readonly fields: Record<string, string[]>,
  ) {
    super(message, { fields });
  }
}
```

Validation: `new NotFoundError('Project', '123')` has `code === ErrorCode.NOT_FOUND` and readable message.

---

## Phase 3 — Infrastructure Errors

**Goal:** Typed infra errors that wrap external failures without leaking provider details.

```typescript
// src/infrastructure/errors/external-service.error.ts
export class ExternalServiceError extends InfrastructureError {
  readonly code = ErrorCode.EXTERNAL_SERVICE_FAILED;
  constructor(
    public readonly service: string,
    public readonly statusCode?: number,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(message ?? `External service '${service}' failed`, context);
  }
}

// src/infrastructure/errors/llm-errors.ts
export class LLMTimeoutError extends InfrastructureError { ... }
export class LLMRateLimitError extends InfrastructureError {
  constructor(public readonly retryAfterSeconds?: number) { ... }
}
export class LLMParsingError extends InfrastructureError {
  constructor(public readonly rawResponse: string, public readonly parseError: Error) { ... }
}
export class LLMAuthError extends InfrastructureError { ... }
```

Validation: Each error class has correct `code`, `layer`, and `name`.

---

## Phase 4 — HTTP Error Mapping

**Goal:** Consistent HTTP status code + RFC 7807 body for each error type.

```typescript
// server/middleware/error-handler.ts
const HTTP_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.VALIDATION_FAILED]: 422,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.EXTERNAL_SERVICE_FAILED]: 502,
  [ErrorCode.LLM_RATE_LIMITED]: 429,
  [ErrorCode.LLM_TIMEOUT]: 504,
  [ErrorCode.INTERNAL]: 500,
};

export function handleError(error: unknown, req: Request, res: Response) {
  if (
    error instanceof DomainError ||
    error instanceof ApplicationError ||
    error instanceof InfrastructureError
  ) {
    const status = HTTP_STATUS_MAP[error.code] ?? 500;
    return res.status(status).json({
      type: `https://errors.yourapp.com/${error.code}`,
      title: error.name,
      status,
      detail: error.message,
      instance: req.url,
    });
  }

  // Unknown error — do not leak stack trace
  console.error("Unhandled error:", error);
  return res.status(500).json({
    type: "https://errors.yourapp.com/internal-server-error",
    title: "Internal Server Error",
    status: 500,
    detail: "An unexpected error occurred.",
    instance: req.url,
  });
}
```

Validation: Integration test — `throw new NotFoundError('Project', '1')` in a route handler produces 404 with RFC 7807 body.

---

## Phase 5 — React Error Boundary

**Goal:** Catch React render errors and display a user-friendly fallback.

```tsx
// app/components/ErrorBoundary.tsx
"use client";
export class ErrorBoundary extends React.Component<
  {
    children: ReactNode;
    fallback?: ComponentType<{ error: Error; reset: () => void }>;
  },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to observability system if installed
    console.error("ErrorBoundary caught:", error, info);
  }
  render() {
    if (this.state.error) {
      const Fallback = this.props.fallback ?? DefaultErrorFallback;
      return (
        <Fallback
          error={this.state.error}
          reset={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
```

`ErrorFallback.tsx` renders a styled error card using design system tokens (if `design-system` is installed).

Validation: Unit test — throw in a child component, assert fallback renders with error message.

---

## Phase 6 — Sentry Integration (opt-in)

**Goal:** Route uncaught infrastructure errors to Sentry without touching application code.

Install: `@sentry/nextjs`

`sentry.server.config.ts` + `sentry.client.config.ts` — initialise Sentry with `SENTRY_DSN`.

Error handler appends `Sentry.captureException(error)` before responding.

`next.config.ts` wrapped with `withSentryConfig`.

```env
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
```

Validation: Trigger a 500 error in dev, assert it appears in Sentry dashboard.

---

## Post-Install Checklist

```
✅ error-handling installed

Next steps:
  1. Import Result from 'src/shared/result.ts' in new use cases
  2. Wrap infrastructure calls in try/catch and return err(new ExternalServiceError(...))
  3. Register handleError in your server middleware chain (see server/middleware/error-handler.ts)
  4. Wrap top-level React trees with <ErrorBoundary> in app/layout.tsx
  5. If Sentry: set SENTRY_DSN in .env.local and verify errors appear in dashboard
```

---

## Template Dependencies

- Soft dependency: `env-setup` (for `SENTRY_DSN` validation)
- Soft dependency: `observability` (error logger; falls back to `console.error`)
- Soft dependency: `design-system` (styled error fallback component)
