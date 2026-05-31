# Google OAuth 2.0 (`google-oauth`)

> Server-side Google OAuth 2.0: authorization-code flow, userinfo fetch, AES-256-GCM session
> cookie, optional hosted-domain restriction, and a root middleware protecting configured paths.

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **ID**        | `google-oauth`                                   |
| **Category**  | Auth provider (adapter group A)                  |
| **Requires**  | `shared-types`, `auth-mock`, `env-setup`         |
| **Conflicts** | every other auth provider (one strategy per app) |
| **Branch**    | `feature/auth-stack-restructure`                 |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Implements a self-contained Google sign-in: login → Google → callback → encrypted session
cookie. Maps Google's userinfo onto the shared `UserContext`. The emitted `middleware.ts`
overwrites `auth-mock`'s while still honouring `AUTH_MODE=mock` for local dev.

## Service & API

- **Provider:** Google OAuth 2.0 (authorization-code flow); userinfo via Google's endpoint.
- **Session:** stateless AES-256-GCM cookie (no DB). Optional `hd` Workspace-domain restriction.
- **Routes:** `GET /api/auth/login/google`, `GET /api/auth/callback/google`, `POST /api/auth/logout/google`, `GET /api/auth/me`.

## Install

`hexagen add google-oauth`. Questions: `redirect_uri`, `scopes` (default `openid,email,profile`),
`hd` (Workspace domain, blank = any), `protected_paths` (`/dashboard,/api/protected`).

Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_OAUTH_SCOPES`,
`GOOGLE_HD`, `AUTH_SESSION_SECRET`.

## Usage

```ts
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { requireAuth } from "@/lib/auth/require-auth";

const user = await getCurrentUser(); // UserContext | null
```

Flow: `GET /api/auth/login/google` → Google → `GET /api/auth/callback/google` → `/dashboard`.

## Configuration

| Env var                                     | Purpose                                              |
| ------------------------------------------- | ---------------------------------------------------- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Cloud Console OAuth credentials                      |
| `GOOGLE_HD`                                 | restrict to a Workspace domain (blank = any)         |
| `AUTH_SESSION_SECRET`                       | `openssl rand -hex 32` — encrypts the session cookie |

## Notes for agents

- `middleware.ts` overwrites `auth-mock`'s; `AUTH_MODE=mock` short-circuits both it and
  `getCurrentUser()` to `MOCK_USER`.
- Mutually exclusive with every other auth provider.

## Checklist (post-install)

Create OAuth credentials; add the redirect URI; set client id/secret; generate
`AUTH_SESSION_SECRET`; choose `AUTH_MODE`; test the login→callback→`/dashboard` flow; verify
`/api/auth/me` and logout.

## Related

Requires [`shared-types`](../shared-types), [`auth-mock`](../auth-mock), [`env-setup`](../env-setup).
Siblings: [`github-oauth`](../github-oauth), [`microsoft-entra`](../microsoft-entra).
