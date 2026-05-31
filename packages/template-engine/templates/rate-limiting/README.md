# Rate Limiting (`rate-limiting`)

> Differentiated middleware (text/image/general), session+IP hybrid identification, configurable
> per-type limits, and proximity-to-limit debug logging.

|               |                                            |
| ------------- | ------------------------------------------ |
| **ID**        | `rate-limiting`                            |
| **Category**  | Core infrastructure                        |
| **Requires**  | `env-setup`                                |
| **Conflicts** | none                                       |
| **Branch**    | `feature/generator-template-rate-limiting` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds middleware that rate-limits requests by type (text vs image vs general — useful for LLM
apps where image generation is far costlier) and identifies callers by a hybrid of session
cookie + client IP. Optionally Redis-backed for multi-instance deployments.

## What it scaffolds

- `server/middleware/rate-limit.ts` — the middleware.
- `server/utils/{rate-limiter,get-client-ip,session-id}.ts`.
- `server/errors/rate-limit-exceeded.error.ts` (429), `types/rate-limit.d.ts`, `.env.rate-limit.example`.

## Install

`hexagen add rate-limiting`. Questions:

| Question              | Options (default)                                        |
| --------------------- | -------------------------------------------------------- |
| `framework`           | `nitro` / `nextjs-api` / `express` / `fastify` (`nitro`) |
| `session_cookie_name` | `__session`                                              |
| `differentiated`      | `true` — separate text/image/general limits              |
| `debug_logging`       | `true`                                                   |
| `redis_backed`        | `false` — Redis for distributed limiting                 |

Env: `TEXT_RPM`, `IMAGE_RPM`, `GENERAL_RPM`, `RATE_LIMIT_WARN_AT`, `RATE_LIMIT_SESSION_TTL`,
`RATE_LIMIT_DEBUG`, `RATE_LIMIT_TRUST_PROXY`.

## Usage

Wire `server/middleware/rate-limit.ts` into your framework's middleware chain; it classifies the
request, identifies the caller, and on exceeding the limit raises an **HTTP 429** via the
framework's `createError` with a structured body (from `buildRateLimitExceededBody`) — handle it
as an HTTP response error, not a thrown `RateLimitExceededError` instance.

## Notes for agents

- Tune per-tier: e.g. `TEXT_RPM=40`, `IMAGE_RPM=12` for the xAI free tier.
- In-memory by default; set `redis_backed=true` for multi-instance correctness.
- If you also enable Better Auth's built-in `rateLimit`, reconcile the two so they don't stack.

## Checklist (post-install)

Merge `.env.rate-limit.example`; set the RPM limits for your tier; confirm the session cookie is
set; `RATE_LIMIT_DEBUG=true` while testing.

## Related

Requires [`env-setup`](../env-setup). Complements [`llm-adapter`](../llm-adapter).
