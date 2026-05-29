# Template: Observability

**Branch:** `feature/generator-template-observability`

## Purpose

Generates structured JSON logging with correlation IDs, request/response logging middleware, a `/api/health` endpoint that reflects real system state, and optional OpenTelemetry trace scaffolding. Gives every request a traceable identity from the moment it enters the system.

---

## Install-Time Questions

| ID                   | Prompt                                  | Type    | Options                                          | Default        |
| -------------------- | --------------------------------------- | ------- | ------------------------------------------------ | -------------- |
| `log_format`         | Log format?                             | select  | `json`, `pretty-dev`, `auto`                     | `auto`         |
| `correlation_header` | Correlation ID header name?             | select  | `x-request-id`, `x-correlation-id`, `x-trace-id` | `x-request-id` |
| `request_logging`    | Log all incoming requests?              | boolean | —                                                | `true`         |
| `log_body`           | Log request/response bodies (redacted)? | boolean | —                                                | `false`        |
| `otel`               | Set up OpenTelemetry tracing?           | boolean | —                                                | `false`        |
| `log_destination`    | Additional log destination?             | select  | `none`, `axiom`, `datadog`, `logtail`            | `none`         |

---

## Files Generated

```
src/
  infrastructure/
    logging/
      logger.ts               # Structured logger (pino or console-based)
      correlation.ts          # Correlation ID generation + extraction
      context.ts              # AsyncLocalStorage-based request context
      redact.ts               # Field redaction for sensitive data
      index.ts
    telemetry/                # (if otel=true)
      tracer.ts
      instrumentation.ts

server/
  middleware/
    request-logger.ts         # Logs request + response with correlation ID
    correlation-id.ts         # Injects correlation ID into request context

app/
  api/
    health/
      route.ts                # GET /api/health → system state

instrumentation.ts            # Next.js OpenTelemetry hook (if otel=true)

.env.observability.example
```

---

## Generated .env Variables

```env
# Observability
LOG_LEVEL=info                 # error | warn | info | debug
LOG_FORMAT=auto                # json (production) | pretty (development) | auto
LOG_INCLUDE_REQUEST_BODY=false # Set true only in development — may log secrets

# Correlation
CORRELATION_ID_HEADER=x-request-id

# OpenTelemetry (if enabled)
OTEL_SERVICE_NAME=my-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Log Destination (if enabled)
AXIOM_TOKEN=
AXIOM_DATASET=
```

---

## Key Design Decisions

**Correlation IDs are first-class citizens:** Every log line includes `{ requestId, userId?, sessionId? }`. The `requestId` is either read from the incoming `X-Request-Id` header (for services that inject it upstream) or generated as a `crypto.randomUUID()` if absent. The same ID appears in the response headers so clients can correlate.

**`AsyncLocalStorage` for ambient context:** Rather than threading `requestId` through every function call, it lives in an `AsyncLocalStorage` store. Any code in the request's async chain can call `getRequestContext()` to include it in logs.

**`auto` log format:** `pretty` in development (human-readable, colourised), `json` in production. Detected by `NODE_ENV`. No manual switching.

**Redaction is declarative:** `redact.ts` exports a `REDACTED_FIELDS` constant (`['password', 'token', 'secret', 'authorization', 'cookie']`). The logger applies this list automatically so sensitive fields never appear in logs.

**Health check reflects real state:** `/api/health` calls `isRedisAvailable()`, `isSupabaseReachable()`, and `isLLMConfigured()` — returns 200 only when all required services are healthy. Returns 503 with a body listing degraded services when something is wrong. This is what load balancers and uptime monitors should ping.

---

## Phase 1 — Logger

**Goal:** Structured logger with `json` / `pretty` modes and log level filtering.

Using `pino` (fast, zero-config JSON logger):

```typescript
// src/infrastructure/logging/logger.ts
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  redact: { paths: REDACTED_FIELDS, censor: "[REDACTED]" },
});
```

If pino is not desired, a `console`-based fallback is generated using the same interface (`logger.info()`, `logger.error()`, `logger.warn()`, `logger.debug()`).

Validation: `logger.info({ requestId: '123' }, 'test')` produces a log line with the correct level and fields.

---

## Phase 2 — Correlation ID & Request Context

**Goal:** Propagate a unique ID through every log line for a given request.

```typescript
// src/infrastructure/logging/context.ts
import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
  startedAt: number;
}

const store = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return store.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return store.getStore();
}
```

`correlation.ts`:

```typescript
export function getOrCreateCorrelationId(req: Request): string {
  return req.headers.get(CORRELATION_ID_HEADER) ?? crypto.randomUUID();
}
```

Validation: Two concurrent requests have different `requestId` values in their logs.

---

## Phase 3 — Request Logger Middleware

**Goal:** Log every request with method, path, status, duration, and correlation ID.

```typescript
// server/middleware/request-logger.ts
export async function requestLoggerMiddleware(req, res, next) {
  const requestId = getOrCreateCorrelationId(req);
  const startedAt = Date.now();

  res.setHeader(CORRELATION_ID_HEADER, requestId);

  await runWithContext({ requestId, startedAt }, async () => {
    await next();

    const duration = Date.now() - startedAt;
    const ctx = getRequestContext();
    logger.info({
      type: "request",
      method: req.method,
      path: req.url,
      status: res.statusCode,
      durationMs: duration,
      requestId: ctx?.requestId,
    });
  });
}
```

Log format:

```json
{
  "level": "info",
  "type": "request",
  "method": "POST",
  "path": "/api/generate",
  "status": 200,
  "durationMs": 342,
  "requestId": "abc-123"
}
```

Validation: Integration test — single request produces one `type: 'request'` log line with all fields.

---

## Phase 4 — Health Check Endpoint

**Goal:** `/api/health` that reflects real system readiness.

```typescript
// app/api/health/route.ts
export async function GET() {
  const checks = await Promise.allSettled([
    checkRedis(), // if redis template installed
    checkSupabase(), // if supabase template installed
    checkLLM(), // if llm-adapter template installed
  ]);

  const results = mapChecks(checks);
  const healthy = results.every((r) => r.status === "ok");

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      version: process.env.npm_package_version ?? "unknown",
      uptime: process.uptime(),
      checks: results,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
```

Response shape:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 342.1,
  "checks": [
    { "name": "redis", "status": "ok", "latencyMs": 2 },
    { "name": "supabase", "status": "ok", "latencyMs": 45 },
    { "name": "llm", "status": "ok", "configured": true }
  ],
  "timestamp": "2026-05-28T12:00:00.000Z"
}
```

Validation: `GET /api/health` returns 200 when all services are up; 503 when Redis is down (assert `checks[0].status === 'degraded'`).

---

## Phase 5 — Rate Limit Status in Health Check (auto if rate-limiting installed)

**Goal:** Surface rate limit counters in the health endpoint for debugging.

If `rate-limiting` is installed, the health check includes:

```json
"rateLimits": {
  "text": { "used": 12, "limit": 40, "resetAt": "2026-05-28T12:01:00.000Z" },
  "image": { "used": 3, "limit": 12, "resetAt": "..." },
  "general": { "used": 8, "limit": 60, "resetAt": "..." }
}
```

This makes it easy to diagnose "why am I getting 429s" without needing Redis CLI access.

Validation: Assert `rateLimits` field appears in health response when rate-limiting template is installed.

---

## Phase 6 — OpenTelemetry (opt-in)

**Goal:** Distributed trace spans for LLM calls, DB queries, and HTTP requests.

`instrumentation.ts` (Next.js OpenTelemetry hook):

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME,
      }),
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      }),
    });
    sdk.start();
  }
}
```

Manual spans in LLM adapter (if installed):

```typescript
const span = tracer.startSpan("llm.call", {
  attributes: { "llm.model": model },
});
// ...
span.end();
```

Validation: Start the app with an OTEL collector running; assert spans appear in the collector UI.

---

## Post-Install Checklist

```
✅ observability installed

Next steps:
  1. Merge .env.observability.example into .env.local
  2. Visit http://localhost:3000/api/health — verify all checks are green
  3. Set LOG_LEVEL=debug to see all request logs during development
  4. Check response headers for X-Request-Id on every API response
  5. If any check is degraded at startup, investigate that service before running demos
  6. See SETUP.md → Observability for OTEL collector setup
```

---

## Template Dependencies

- No required dependencies (this template is standalone)
- Auto-enriches: `rate-limiting` (adds rate limit status to health check)
- Auto-enriches: `llm-adapter` (adds `llm` check to health endpoint)
- Auto-enriches: `supabase` (adds `supabase` check to health endpoint)
- Auto-enriches: `bullmq` (adds `redis`/`bullmq` check to health endpoint; structured worker logging)
- Used by: `error-handling` (error logger replaces `console.error`)
