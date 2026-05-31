# Microsoft Entra ID (`microsoft-entra`)

> Entra ID (Azure AD) confidential-client PKCE flow, Microsoft Graph profile + group fetch, AAD
> group→role mapping, AES-256-GCM session cookie, and a root middleware protecting configured paths.

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **ID**        | `microsoft-entra`                                |
| **Category**  | Auth provider (adapter group A)                  |
| **Requires**  | `shared-types`, `auth-mock`, `env-setup`         |
| **Conflicts** | every other auth provider (one strategy per app) |
| **Branch**    | `feature/auth-stack-restructure`                 |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Entra ID sign-in with optional role mapping: login → Microsoft → callback → encrypted session.
Fetches the profile (and groups) from Microsoft Graph and can map AAD group object IDs to
application roles on the shared `UserContext`. The emitted `middleware.ts` overwrites
`auth-mock`'s while honouring `AUTH_MODE=mock`.

## Service & API

- **Provider:** Microsoft Entra ID, confidential-client **PKCE**; profile/groups via Microsoft Graph.
- **Session:** stateless AES-256-GCM cookie. Optional AAD group→role mapping.
- **Routes:** `GET /api/auth/login/entra`, `/callback/entra`, `/logout/entra`, `GET /api/auth/me`.

## Install

`hexagen add microsoft-entra`. Questions: `redirect_uri`, `scopes`
(`openid,profile,email,User.Read`), `group_role_mapping` (bool), `group_role_map` (JSON),
`protected_paths`.

Env: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`,
`ENTRA_SCOPES`, `ENTRA_GROUP_ROLE_MAPPING`, `ENTRA_GROUP_ROLE_MAP`, `AUTH_SESSION_SECRET`.

## Usage

```ts
import { getCurrentUser } from "@/lib/auth/get-current-user";
const user = await getCurrentUser(); // UserContext with mapped roles
```

Flow: `GET /api/auth/login/entra` → Microsoft → `/callback/entra` → `/dashboard`.

## Notes for agents

- Group role mapping needs `GroupMember.Read.All` (delegated) + admin consent; map is
  `{ "<group-oid>": "role" }`.
- `middleware.ts` overwrites `auth-mock`'s; `AUTH_MODE=mock` short-circuits to `MOCK_USER`.
- Mutually exclusive with every other auth provider.

## Checklist (post-install)

Register an app; add the Web redirect URI; grant `User.Read` (+ `GroupMember.Read.All` if
mapping); set tenant/client/secret; generate `AUTH_SESSION_SECRET`; test the
login→callback→`/dashboard` flow; verify roles on `/api/auth/me`.

## Related

Requires [`shared-types`](../shared-types), [`auth-mock`](../auth-mock), [`env-setup`](../env-setup).
Siblings: [`google-oauth`](../google-oauth), [`github-oauth`](../github-oauth).
