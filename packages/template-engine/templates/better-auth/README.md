# Better Auth (`better-auth`)

> Standalone Better Auth server: email/password + Google/GitHub social, a magic-link plugin,
> built-in rate limiting, a typed auth client, and a core DB schema + migration.

|               |                                                            |
| ------------- | ---------------------------------------------------------- |
| **ID**        | `better-auth`                                              |
| **Category**  | Auth framework (group B)                                   |
| **Requires**  | `env-setup`                                                |
| **Conflicts** | every other auth provider/framework (one strategy per app) |
| **Branch**    | `feature/generator-template-better-auth`                   |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

A self-hosted auth server: email/password plus social providers and an opt-in magic-link plugin,
backed by a Drizzle/Postgres schema. Ships a typed client and the `[...all]` route handler.

## Service & API

- **Framework:** Better Auth. Providers activate from env at runtime; magic-link is opt-in via
  `BETTER_AUTH_MAGIC_LINK`.
- **DB:** Drizzle/Postgres scaffolded (Prisma/Kysely require swapping the adapter + regenerating).
- **Routes:** `/api/auth/[...all]`.

## Install

`hexagen add better-auth`. Questions: `providers` (multiselect: email-password/google/github/
magic-link), `database` (`drizzle`/`prisma`/`kysely`), `session_expiry_days`, `rate_limiting` (bool).

Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`. Emits `src/lib/auth.ts`,
`src/lib/auth-client.ts`, `src/db/index.ts`, the route handler, `src/db/schema/better-auth.ts`,
`src/db/migrations/0001_better_auth.sql`, `.env.better-auth.example`.

## Usage

```ts
import { auth } from "@/lib/auth"; // server
import { authClient } from "@/lib/auth-client"; // client
// GET /api/auth/get-session returns the active session
```

## Notes for agents

- `npm install better-auth drizzle-orm pg` (+ `-D @types/pg`); apply the migration.
- Social providers activate when both their `GOOGLE_*` / `GITHUB_*` vars are present.
- Magic-link: implement `sendMagicLink()` delivery, then set `BETTER_AUTH_MAGIC_LINK=true`.
- If you also install the `rate-limiting` template, reconcile it with Better Auth's built-in.
- Standalone — conflicts with every other auth template.

## Checklist (post-install)

Install deps; merge env; generate `BETTER_AUTH_SECRET`; set `BETTER_AUTH_URL` + `DATABASE_URL`;
apply the migration; set social creds; wire magic-link delivery if used; test sign-up + session.

## Related

Requires [`env-setup`](../env-setup). Alternatives: [`nextauth`](../nextauth), [`clerk`](../clerk).
