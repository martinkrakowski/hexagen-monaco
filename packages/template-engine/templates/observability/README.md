# Observability (`observability`)

> Structured JSON logging, correlation IDs via `AsyncLocalStorage`, a request-logger
> middleware, a `/api/health` endpoint, and optional OpenTelemetry tracing.

|               |                                            |
| ------------- | ------------------------------------------ |
| **ID**        | `observability`                            |
| **Category**  | Core infrastructure                        |
| **Requires**  | —                                          |
| **Conflicts** | none                                       |
| **Branch**    | `feature/generator-template-observability` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Gives every request a correlation id (propagated through `AsyncLocalStorage`), a structured
logger with redaction, a request-logging middleware, and a health endpoint to extend as you add
backing services.

## What it scaffolds

- `src/infrastructure/logging/{logger,correlation,context,redact,index}.ts`.
- `server/middleware/request-logger.ts` — request logging + correlation seeding.
- `app/api/health/route.ts` — `/api/health` (extend its `checks` array).
- Optional `instrumentation.ts` + `.env.otel.example` (OTel).

## Install

`hexagen add observability`. Questions:

| Question             | Options (default)                                                   |
| -------------------- | ------------------------------------------------------------------- |
| `log_format`         | `json` / `pretty-dev` / `auto` (`auto`)                             |
| `correlation_header` | `x-request-id` / `x-correlation-id` / `x-trace-id` (`x-request-id`) |
| `otel`               | `false`                                                             |

## Usage

```ts
import { logger } from "@/infrastructure/logging";
import { runWithContext } from "@/infrastructure/logging/context";
import { getOrCreateCorrelationId } from "@/infrastructure/logging/correlation";

logger.info({ userId }, "user.created"); // fields first; correlation id attached automatically
```

```bash
curl localhost:3000/api/health
```

## Notes for agents

- All env vars are optional — the logger has defaults. Set `LOG_LEVEL=debug` to see request logs.
- Extend `/api/health`'s `checks` as you add Redis/Supabase/LLM templates.
- If `error-handling`'s React boundary is installed, swap its `console.error` for this logger.
- The `bedrock-agentcore-runtime` handler seeds this correlation store from `runtimeSessionId`
  so app logs and AgentCore OTEL→CloudWatch traces share one id.

## Checklist (post-install)

Merge `.env.observability.example`; wire `requestLoggerMiddleware` (or `runWithContext`); hit
`/api/health`; set `LOG_LEVEL=debug`; install OTel deps if enabled.

## Related

Pairs with [`error-handling`](../error-handling); referenced by
[`bedrock-agentcore-runtime`](../bedrock-agentcore-runtime) and [`docker`](../docker) (health path).
