# Magic Link — Passwordless (`magic-link`)

> HMAC-SHA256 signed single-use tokens, Resend/Nodemailer transport, an LRU replay store,
> AES-256-GCM session cookie, and a root middleware protecting configured paths.

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **ID**        | `magic-link`                                     |
| **Category**  | Auth provider (adapter group A)                  |
| **Requires**  | `shared-types`, `auth-mock`, `env-setup`         |
| **Conflicts** | every other auth provider (one strategy per app) |
| **Branch**    | `feature/auth-stack-restructure`                 |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Passwordless email sign-in: request → emailed signed link → verify → encrypted session. Tokens
are HMAC-signed, single-use (a 10k-entry LRU replay store rejects reuse), and short-lived. The
emitted `middleware.ts` overwrites `auth-mock`'s while honouring `AUTH_MODE=mock`.

## Service & API

- **Token:** HMAC-SHA256, single-use, TTL-bounded; replay-guarded.
- **Email transport:** Resend or Nodemailer (SMTP).
- **Session:** stateless AES-256-GCM cookie.
- **Routes:** `POST /api/auth/magic-link/request`, `GET /api/auth/magic-link/verify`,
  `DELETE /api/auth/logout`, `GET /api/auth/me`.

## Install

`hexagen add magic-link`. Questions: `email_transport` (`resend`/`nodemailer`), `from_address`,
`token_ttl_minutes` (`15`), `app_url`, `protected_paths`.

Env: `MAGIC_LINK_SECRET`, `MAGIC_LINK_TTL_MINUTES`, `MAGIC_LINK_FROM`, `MAGIC_LINK_TRANSPORT`,
`APP_URL`, `RESEND_API_KEY`, `SMTP_*`, `AUTH_SESSION_SECRET`.

## Usage

```ts
// Request a link:
await fetch("/api/auth/magic-link/request", {
  method: "POST",
  body: JSON.stringify({ email }),
});
// Verify: GET /api/auth/magic-link/verify?token=... → session → /dashboard

import { getCurrentUser } from "@/lib/auth/get-current-user";
const user = await getCurrentUser();
```

## Notes for agents

- Generate `MAGIC_LINK_SECRET` and `AUTH_SESSION_SECRET` separately (`openssl rand -hex 32`).
- Resend → set `RESEND_API_KEY`; Nodemailer → `npm install nodemailer` + `SMTP_*`.
- Second use of a link returns "already used" (the replay store).
- Mutually exclusive with every other auth provider.

## Checklist (post-install)

Set both secrets; configure the transport + verified `from`; test request→inbox→verify→
`/dashboard`; confirm reuse is rejected; verify `/api/auth/me`, then log out via `DELETE /api/auth/logout`.

## Related

Requires [`shared-types`](../shared-types), [`auth-mock`](../auth-mock), [`env-setup`](../env-setup).
