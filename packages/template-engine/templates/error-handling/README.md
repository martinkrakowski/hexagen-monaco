# Error Handling (`error-handling`)

> A 3-layer error hierarchy, the `Result<T, E>` type, RFC 7807 HTTP mapping, and an optional
> React error boundary. The typed-failure foundation other templates return through.

|               |                                             |
| ------------- | ------------------------------------------- |
| **ID**        | `error-handling`                            |
| **Category**  | Core infrastructure                         |
| **Requires**  | `env-setup`                                 |
| **Conflicts** | none                                        |
| **Branch**    | `feature/generator-template-error-handling` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Establishes how failures are modelled and surfaced: domain / application / infrastructure
error layers, a `Result<T, E>` (`ok` / `err`) for expected failures, and an HTTP mapper. The
Adobe Firefly and LLM templates return `Result<T, …Error>` defined here.

## What it scaffolds

- `src/shared/result.ts` — `Result<T, E>`, `ok`, `err`.
- `src/domain/errors/*` — `DomainError`, `NotFoundError`, `ValidationError`, `AuthorizationError`.
- `src/application/errors/application.error.ts`, `src/infrastructure/errors/*` (incl. `ExternalServiceError`, `llm-errors`).
- `server/middleware/error-handler.ts` — `handleError(error, instance)` → HTTP response.
- Optional `app/components/ErrorBoundary.tsx` + `ErrorFallback.tsx`; optional `.env.sentry.example`.

## Install

`hexagen add error-handling`. Questions:

| Question         | Options (default)                                                           |
| ---------------- | --------------------------------------------------------------------------- |
| `http_mapping`   | `status-codes` / `rfc7807-problem-json` / `custom` (`rfc7807-problem-json`) |
| `react_boundary` | `true`                                                                      |
| `sentry`         | `false`                                                                     |

## Usage

```ts
import { ok, err, type Result } from "@/shared/result";
import { ExternalServiceError } from "@/infrastructure/errors/external-service.error";
import { handleError } from "@/server/middleware/error-handler";

async function loadUser(id: string): Promise<Result<User, NotFoundError>> {
  const u = await repo.find(id);
  return u ? ok(u) : err(new NotFoundError(`user ${id}`));
}

// In a route: Next.js → Response.json(body, { status })
const { body, status } = handleError(error, req.url);
```

## Notes for agents

- **Return `Result<T, E>` from use cases that can fail expectedly; throw only for
  programmer/config errors** — the standing convention across the repo.
- Wrap infra failures as `err(new ExternalServiceError(...))`, then re-wrap at the application
  boundary so lower layers don't leak upward.
- Sentry is opt-in: `npm install @sentry/node`, set `SENTRY_DSN`.

## Checklist (post-install)

Use `Result<T,E>`; wrap infra→application errors; call `handleError` in routes; wrap trees with
`<ErrorBoundary>`; wire Sentry if enabled.

## Related

Requires [`env-setup`](../env-setup). Used by [`llm-adapter`](../llm-adapter) and the Adobe
Firefly family ([`adobe-firefly-core`](../adobe-firefly-core)).
