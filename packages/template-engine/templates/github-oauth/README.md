# GitHub OAuth (`github-oauth`)

> GitHub OAuth App integration: code exchange, primary-email fetch, org-membership gate,
> AES-256-GCM session cookie, and a root middleware protecting configured paths.

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **ID**        | `github-oauth`                                   |
| **Category**  | Auth provider (adapter group A)                  |
| **Requires**  | `shared-types`, `auth-mock`, `env-setup`         |
| **Conflicts** | every other auth provider (one strategy per app) |
| **Branch**    | `feature/auth-stack-restructure`                 |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

GitHub sign-in with an optional org gate: login → GitHub → callback → encrypted session. Fetches
the user's primary email and maps the profile onto the shared `UserContext`. The emitted
`middleware.ts` overwrites `auth-mock`'s while honouring `AUTH_MODE=mock`.

## Service & API

- **Provider:** GitHub OAuth App (authorization-code flow); primary-email + (optional)
  org-membership fetch.
- **Session:** stateless AES-256-GCM cookie. Optional `GITHUB_ALLOWED_ORGS` gate.
- **Routes:** `GET /api/auth/login/github`, `/callback/github`, `/logout/github`, `GET /api/auth/me`.

## Install

`hexagen add github-oauth`. Questions: `redirect_uri`, `scopes` (default `read:user,user:email`),
`allowed_orgs` (blank = any), `protected_paths`.

Env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`, `GITHUB_OAUTH_SCOPES`,
`GITHUB_ALLOWED_ORGS`, `AUTH_SESSION_SECRET`.

## Usage

```ts
import { getCurrentUser } from "@/lib/auth/get-current-user";
const user = await getCurrentUser(); // UserContext | null
```

Flow: `GET /api/auth/login/github` → GitHub → `/callback/github` → `/dashboard`.

## Notes for agents

- For `GITHUB_ALLOWED_ORGS`, the token needs the `read:org` scope.
- `middleware.ts` overwrites `auth-mock`'s; `AUTH_MODE=mock` short-circuits to `MOCK_USER`.
- Mutually exclusive with every other auth provider.

## Checklist (post-install)

Create an OAuth App; set the callback URL; set client id/secret; generate `AUTH_SESSION_SECRET`;
add `read:org` if gating by org; test the login→callback→`/dashboard` flow; verify `/api/auth/me`
and logout.

## Related

Requires [`shared-types`](../shared-types), [`auth-mock`](../auth-mock), [`env-setup`](../env-setup).
Siblings: [`google-oauth`](../google-oauth), [`microsoft-entra`](../microsoft-entra).
