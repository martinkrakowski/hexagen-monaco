# Template: Rate Limiting

**Branch:** `feature/generator-template-rate-limiting`

## Purpose

Generates a production-ready, differentiated rate limiting layer with session-cookie + IP hybrid identification, configurable limits per request type, debug logging, and consistent 429 responses. Eliminates the most common first-day friction on new API projects.

---

## Install-Time Questions

| ID                    | Prompt                                                     | Type    | Options                                     | Default     |
| --------------------- | ---------------------------------------------------------- | ------- | ------------------------------------------- | ----------- |
| `framework`           | Which server framework?                                    | select  | `nitro`, `nextjs-api`, `express`, `fastify` | `nitro`     |
| `session_cookie_name` | Session cookie name?                                       | text    | —                                           | `__session` |
| `cookie_max_age_days` | Cookie max age (days)?                                     | select  | `1`, `7`, `30`, `90`                        | `7`         |
| `differentiated`      | Differentiate limits by request type (text/image/general)? | boolean | —                                           | `true`      |
| `debug_logging`       | Enable proximity-to-limit debug logging?                   | boolean | —                                           | `true`      |
| `redis_backed`        | Use Redis for distributed rate limiting (multi-instance)?  | boolean | —                                           | `false`     |

---

## Files Generated

```
server/
  middleware/
    rate-limit.ts          # Global middleware, wires all strategies
  utils/
    rate-limiter.ts        # Fixed-window counter, keyed by clientId
    get-client-ip.ts       # X-Forwarded-For → socket.remoteAddress fallback
    session-id.ts          # Cookie minting + reading
  errors/
    rate-limit-exceeded.error.ts

types/
  rate-limit.d.ts          # RateLimitContext, RateLimitConfig, LimitBucket

.env.rate-limit.example    # Additions to merge into .env.example
```

---

## Generated .env Variables

```env
# Rate Limiting
TEXT_RPM=40
IMAGE_RPM=12
GENERAL_RPM=60
RATE_LIMIT_WARN_AT=0.8        # Warn at 80% of limit
RATE_LIMIT_SESSION_TTL=604800  # 7 days in seconds
RATE_LIMIT_DEBUG=false
```

---

## Key Design Decisions

**Session + IP hybrid:** The client ID is `sessionId` (from httpOnly cookie) with IP as fallback when no cookie is present. This handles both authenticated and anonymous users without requiring login.

**Fixed-window per minute:** Simple, predictable, and easy to explain. Sliding window is more accurate but adds complexity without meaningful benefit at typical API RPM ranges.

**No Redis by default:** In-memory store works for single-instance deployments (most demos and early-stage apps). The Redis path is opt-in so the template doesn't force an infrastructure dependency.

**Differentiated buckets:** Text, image, and general requests are tracked in separate counters so an image-heavy session can't block text responses and vice versa.

---

## Phase 1 — Core Rate Limiter Utility

**Goal:** Working in-memory fixed-window rate limiter with clean TypeScript types.

Files:

- `server/utils/rate-limiter.ts`
- `types/rate-limit.d.ts`

Deliverable: `RateLimiter` class with `check(clientId, bucket)` → `{ allowed, remaining, resetAt }`.

Validation: Unit test with 3 request types, confirming block at limit and reset after window.

---

## Phase 2 — Client Identification

**Goal:** Reliable, consistent client ID derivation without requiring auth.

Files:

- `server/utils/get-client-ip.ts`
- `server/utils/session-id.ts`

`get-client-ip.ts`:

- Reads `X-Forwarded-For` (first IP only, not full chain)
- Falls back to `req.socket.remoteAddress`
- Strips IPv6-mapped IPv4 prefix (`::ffff:`)

`session-id.ts`:

- Reads `__session` cookie from request
- If absent: generates `crypto.randomUUID()`, mints a new cookie in the response
- Cookie flags: `httpOnly: true`, `sameSite: 'lax'`, `secure: true` (prod only), `maxAge: SESSION_TTL`

Validation: Confirm new cookie is set on first request; same ID returned on second request.

---

## Phase 3 — Differentiated Middleware

**Goal:** Single middleware file that routes requests into the correct bucket and blocks at limit.

Files:

- `server/middleware/rate-limit.ts`

Logic:

```
POST /api/generate/text      → bucket: "text"
POST /api/generate/image     → bucket: "image"
GET  /api/*                  → bucket: "general"
POST /api/*                  → bucket: "general"
```

Bucket routing is driven by a `BUCKET_ROUTES` config constant so users can override without touching middleware logic.

Validation: Integration test — 41 text requests from same session ID; 41st returns 429 with correct body.

---

## Phase 4 — 429 Response Standardization

**Goal:** Consistent 429 structure across all routes, including `retryAfter`.

Files:

- `server/errors/rate-limit-exceeded.error.ts`

Response shape:

```json
{
  "error": "rate_limit_exceeded",
  "bucket": "text",
  "limit": 40,
  "remaining": 0,
  "retryAfter": 23,
  "message": "Too many text requests. Try again in 23 seconds."
}
```

Response headers:

```
X-RateLimit-Limit: 40
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <unix-timestamp>
Retry-After: 23
```

Validation: Assert headers and body shape match spec in middleware test.

---

## Phase 5 — Debug Logging & Proximity Warnings

**Goal:** Structured log events for rate limit checks, with warnings near threshold.

Behaviour (only when `RATE_LIMIT_DEBUG=true`):

- Every request: `[rate-limit] clientId=xxx bucket=text remaining=38/40`
- At `WARN_AT` threshold (80%): `[rate-limit:warn] clientId=xxx bucket=text at 33/40 (82%)`
- On block: `[rate-limit:block] clientId=xxx bucket=text limit=40 resetAt=...`

Integrates with the Observability template's structured logger if present; falls back to `console.log` if not.

Validation: Set `RATE_LIMIT_DEBUG=true`, make 34 requests, assert warning log appears.

---

## Phase 6 — Redis Adapter (opt-in)

**Goal:** Drop-in replacement for in-memory store when `REDIS_URL` is present.

Files:

- `server/utils/rate-limiter-redis.ts`

Uses Redis `INCR` + `EXPIREAT` for atomic fixed-window counting. Auto-selected when `REDIS_URL` is set in env; in-memory store used otherwise. No code change required.

Validation: Integration test with a real Redis connection (or `ioredis-mock`), asserting cross-instance consistency.

---

## Post-Install Checklist

```
✅ rate-limiting installed

Next steps:
  1. Merge .env.rate-limit.example into your .env.local
  2. Set TEXT_RPM and IMAGE_RPM to match your provider's tier limits
  3. Open browser DevTools → Application → Cookies and confirm __session is set
  4. Set RATE_LIMIT_DEBUG=true during local testing to see limit proximity logs
  5. See SETUP.md → Rate Limiting for provider-specific limit values
```

---

## Template Dependencies

- Soft dependency: `env-setup` (for .env validation)
- Soft dependency: `observability` (structured logging; falls back to console)
- Soft dependency: `docker` (for Redis service in docker-compose when Redis mode is enabled)
