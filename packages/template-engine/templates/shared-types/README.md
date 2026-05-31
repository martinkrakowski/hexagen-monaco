# Shared Types (`shared-types`)

> The auth-ecosystem foundation: the `UserContext` domain type, a runtime-overridable
> `MOCK_USER`, and generic AES-256-GCM session-cookie helpers (incl. the canonical
> `COOKIE_NAME`). Carries no opinion about mock vs. real auth.

|               |                                            |
| ------------- | ------------------------------------------ |
| **ID**        | `shared-types`                             |
| **Category**  | Foundation (auth)                          |
| **Requires**  | `env-setup`                                |
| **Conflicts** | none                                       |
| **Branch**    | `feature/shared-types-and-derived-answers` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Defines the shape every auth provider speaks (`UserContext`: id, email, name, roles,
avatarUrl) plus the shared session-cookie machinery, so `auth-mock` and every real provider
build on one contract instead of re-deriving it.

## What it scaffolds

- `src/domain/value-objects/user-context.ts` — the domain-owned `UserContext`.
- `src/infrastructure/auth/mock-user.ts` — `MOCK_USER` (env-overridable defaults).
- `src/infrastructure/auth/session/session-manager.ts` — AES-256-GCM cookie helpers + `COOKIE_NAME`.

## Install

`hexagen add shared-types`. Question: `session_cookie_name` (default `__auth_session`).

Env: `AUTH_COOKIE_NAME`, `AUTH_SESSION_MAX_AGE`, `MOCK_USER_ID`, `MOCK_USER_NAME`,
`MOCK_USER_EMAIL`, `MOCK_USER_ROLES`, `MOCK_USER_AVATAR_URL`.

## Usage

```ts
import type { UserContext } from "@/domain/value-objects/user-context";
import { COOKIE_NAME } from "@/infrastructure/auth/session/session-manager";
import { MOCK_USER } from "@/infrastructure/auth/mock-user";
```

## Notes for agents

- **Import `COOKIE_NAME` from `session-manager` — never re-derive it** in provider code.
- `MOCK_USER` defaults are hardcoded but overridable at runtime via `MOCK_USER_*` env vars.
- This template is auth-agnostic; the mock vs. real decision lives in `auth-mock` and the providers.

## Checklist (post-install)

`UserContext` is the shared shape; `MOCK_USER` overrides via env; import `COOKIE_NAME` from
`session-manager`.

## Related

Prerequisite for [`auth-mock`](../auth-mock), `google-oauth`, `github-oauth`,
`microsoft-entra`, `magic-link`, `supabase-auth`, `adobe-ims-spa`. Requires
[`env-setup`](../env-setup).
