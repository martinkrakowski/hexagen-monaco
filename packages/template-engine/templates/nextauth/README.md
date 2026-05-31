# Auth.js — NextAuth v5 (`nextauth`)

> Standalone Auth.js v5 setup: Google/GitHub/Credentials providers, Edge-safe config split, JWT
> session strategy, typed `session.user`, and matcher-based route-protection middleware.

|               |                                                            |
| ------------- | ---------------------------------------------------------- |
| **ID**        | `nextauth`                                                 |
| **Category**  | Auth framework (group B)                                   |
| **Requires**  | `env-setup`                                                |
| **Conflicts** | every other auth provider/framework (one strategy per app) |
| **Branch**    | `feature/generator-template-nextauth`                      |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

A complete Auth.js v5 install with the Edge-safe `auth.config.ts` / `auth.ts` split, the
`[...nextauth]` route handler, a typed session augmentation, and matcher-based middleware. Unlike
the adapter-group providers it does **not** build on `shared-types`/`auth-mock` — it's a
self-contained framework.

## Service & API

- **Framework:** Auth.js (NextAuth) v5. Providers: Google, GitHub, Credentials, Email.
- **Session:** `jwt` (default) or `database`.
- **Routes:** `/api/auth/[...nextauth]` (sign-in/out/callbacks).

## Install

`hexagen add nextauth`. Questions: `providers` (multiselect, default `[google, github]`),
`session_strategy` (`jwt`/`database`), `protected_paths`, `trust_host`.

Env: `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`,
`AUTH_GITHUB_SECRET`. Emits `src/auth.ts`, `src/auth.config.ts`, `types/next-auth.d.ts`,
`middleware.ts`, the route handler, `.env.nextauth.example`.

## Usage

```ts
import { auth } from "@/auth";
const session = await auth(); // typed session.user
// middleware.ts protects the configured paths via the matcher
```

## Notes for agents

- `npm install next-auth@beta bcryptjs` (+ `@auth/prisma-adapter` for `session_strategy=database`).
- `AUTH_SECRET` via `openssl rand -base64 32`; `AUTH_URL` required in production.
- Prune unused providers from `auth.config.ts`/`auth.ts`; implement `lookupUser()` for Credentials.
- Standalone — conflicts with every other auth template.

## Checklist (post-install)

Install deps; merge env; generate `AUTH_SECRET`; set provider id/secrets; set `AUTH_URL`; remove
unused providers; test `GET /api/auth/signin`.

## Related

Requires [`env-setup`](../env-setup). Alternatives: [`clerk`](../clerk), [`better-auth`](../better-auth),
the adapter-group OAuth providers.
