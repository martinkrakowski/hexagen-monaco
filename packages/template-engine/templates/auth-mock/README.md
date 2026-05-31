# Auth Mock (`auth-mock`)

> Dev-only root middleware that injects `shared-types`' `MOCK_USER` as `x-user-context` when
> `AUTH_MODE=mock`. Real providers ship their own middleware that overwrites this one.

|               |                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **ID**        | `auth-mock`                                                                                     |
| **Category**  | Auth (dev short-circuit)                                                                        |
| **Requires**  | `shared-types`, `env-setup`                                                                     |
| **Conflicts** | none (but standalone frameworks like `nextauth`/`clerk`/`better-auth` declare it as a conflict) |
| **Branch**    | `feature/shared-types-and-derived-answers`                                                      |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Lets you build against a known user without a real IdP. When `AUTH_MODE=mock`, the middleware
attaches `MOCK_USER` (from `shared-types`) as the `x-user-context` header on every request. Every
real adapter-group provider (`google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`,
`supabase-auth`, `adobe-ims-spa`) overwrites this `middleware.ts` and still honours
`AUTH_MODE=mock` as a dev short-circuit.

## What it scaffolds

`middleware.ts`, `.env.auth.example`. The `session_cookie_name` question is **auto-derived**
from `shared-types.session_cookie_name`.

## Install

`hexagen add auth-mock`. Env introduced: `AUTH_MODE`.

## Usage

```bash
AUTH_MODE=mock   # middleware injects MOCK_USER as x-user-context
```

Override the mock identity via `MOCK_USER_NAME` / `MOCK_USER_EMAIL` / `MOCK_USER_ROLES` /
`MOCK_USER_AVATAR_URL` (defined in `shared-types`).

## Notes for agents

- This is **dev-only** — it trusts a header and authenticates nobody. Never ship with
  `AUTH_MODE=mock` in production.
- A real provider's `middleware.ts` replaces this file; the mock path survives as the
  `AUTH_MODE=mock` branch inside it.

## Checklist (post-install)

Set `AUTH_MODE=mock` in dev; mock values + overrides live in `shared-types`; a real provider
overwrites this middleware.

## Related

Requires [`shared-types`](../shared-types), [`env-setup`](../env-setup). Superseded at runtime by
any real auth provider.
