# Supabase Auth (`supabase-auth`)

> Authentication layered on the `supabase` template: an `@supabase/ssr` root middleware that
> refreshes the session and protects paths, plus `getCurrentUser`/`requireAuth` and `/api/auth/me`.

|               |                                                            |
| ------------- | ---------------------------------------------------------- |
| **ID**        | `supabase-auth`                                            |
| **Category**  | Auth provider (on Supabase)                                |
| **Requires**  | `supabase`, `shared-types`, `auth-mock`, `env-setup`       |
| **Conflicts** | every other auth provider/framework (one strategy per app) |
| **Branch**    | `feature/shared-types-and-derived-answers`                 |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds session auth on top of the `supabase` storage/DB template: middleware that refreshes the
`@supabase/ssr` session and guards `protected_paths`, the standard `getCurrentUser`/`requireAuth`
helpers, and `/api/auth/me` — all honouring `AUTH_MODE=mock`. Sign-in/up wiring is yours (use
the `supabase` client's `signInWithPassword` / `signInWithOAuth`).

## Service & API

- **Provider:** Supabase Auth via `@supabase/ssr`. **Session:** server-validated `getUser()`.
- **Routes/middleware:** `middleware.ts`, `GET /api/auth/me`.

## Install

`hexagen add supabase-auth`. Question: `protected_paths`. No new env vars (inherits from
`supabase`). Emits `middleware.ts`, `src/lib/auth/get-current-user.ts`,
`src/lib/auth/require-auth.ts`, `app/api/auth/me/route.ts`.

## Usage

```ts
import { getCurrentUser } from "@/lib/auth/get-current-user";
const user = await getCurrentUser(); // backed by Supabase's server-validated getUser()
```

## Notes for agents

- **Authorize off `getUser()`, never `getSession()`** locally — `getCurrentUser` already does.
- `middleware.ts` overwrites `auth-mock`'s; `AUTH_MODE=mock` short-circuits to `MOCK_USER`.
- Requires the [`supabase`](../supabase) template (it owns the clients); standalone-exclusive.

## Checklist (post-install)

Wire sign-in/up with the `supabase` client; set `AUTH_MODE`; rely on `getUser()`; configure
`protected_paths`.

## Related

Requires [`supabase`](../supabase), [`shared-types`](../shared-types), [`auth-mock`](../auth-mock),
[`env-setup`](../env-setup).
