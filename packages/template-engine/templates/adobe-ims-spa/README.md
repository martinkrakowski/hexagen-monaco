# Adobe IMS SPA — PKCE (`adobe-ims-spa`)

> Adobe IMS Single Page App login via the OAuth **PKCE** flow: login/callback/logout/me
> routes, an encrypted token store, silent auto-refresh, and a root middleware protecting
> configured paths — while still honouring `AUTH_MODE=mock` for local dev.

|               |                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**        | `adobe-ims-spa`                                                                                                                                  |
| **Category**  | Auth provider (Adobe IMS)                                                                                                                        |
| **Requires**  | `shared-types`, `auth-mock`, `env-setup`                                                                                                         |
| **Conflicts** | `nextauth`, `clerk`, `better-auth`, `google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`, `supabase-auth` (one auth provider per app) |
| **Branch**    | `feature/auth-stack-restructure`                                                                                                                 |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

> **Note:** this is **end-user** Adobe IMS authentication for a web app — distinct from
> [`adobe-firefly-core`](../adobe-firefly-core), which uses **Server-to-Server** IMS to call
> Firefly APIs. They share the IMS provider but solve different problems and do not depend on
> each other.

## What it does

Implements a Next.js IMS auth stack: a browser-initiated **PKCE** authorize → callback →
session flow. Tokens are stored AES-256-GCM-encrypted, refreshed silently before expiry, and
a root `middleware.ts` validates IMS sessions on protected paths. `IMSAuthPort` abstracts the
IMS calls; `getCurrentUser()` / `requireAuth()` are the app-facing helpers.

## Service & API

- **Provider:** Adobe IMS (`prod` / `stage`). **Flow:** OAuth 2.0 Authorization Code + PKCE.
- **Port `IMSAuthPort`:** `exchangeCode`, `refreshToken`, `revokeToken`, `fetchProfile`
  (→ `IMSUserProfile`).
- **Routes:** `GET /api/auth/login`, `GET /api/auth/callback`, `DELETE /api/auth/logout`,
  `GET /api/auth/me`.

## Install

`hexagen add adobe-ims-spa`. Questions:

| Question          | Default                                   |
| ----------------- | ----------------------------------------- |
| `redirect_uri`    | `http://localhost:3000/api/auth/callback` |
| `scopes`          | `openid,AdobeID,read_organizations`       |
| `environment`     | `prod` / `stage` (`prod`)                 |
| `auto_refresh`    | `true`                                    |
| `protected_paths` | `/dashboard,/api/protected`               |

Env: `ADOBE_IMS_CLIENT_ID`, `ADOBE_IMS_REDIRECT_URI`, `ADOBE_IMS_SCOPES`,
`ADOBE_IMS_ENVIRONMENT`, `ADOBE_IMS_AUTO_REFRESH`, `AUTH_SESSION_SECRET`. Emits the
`ims-auth.port.ts`, the `infrastructure/auth/adobe-ims/*` adapter set, the four route
handlers, `middleware.ts`, the `get-current-user` / `require-auth` helpers, and
`.env.adobe-ims.example`.

## Usage

```ts
// Server Component or Server Action:
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { requireAuth } from "@/lib/auth/require-auth";

const user = await getCurrentUser(); // UserContext | null
const authed = await requireAuth(); // throws/redirects if unauthenticated
```

Login flow: `GET /api/auth/login` → IMS authorize → `GET /api/auth/callback` → `/dashboard`.
`GET /api/auth/me` returns the `UserContext` after login.

## Configuration

| Env var                  | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `ADOBE_IMS_CLIENT_ID`    | Developer Console **Single Page App** credential  |
| `ADOBE_IMS_REDIRECT_URI` | OAuth callback URI (must match the console)       |
| `ADOBE_IMS_SCOPES`       | requested scopes                                  |
| `ADOBE_IMS_ENVIRONMENT`  | `prod` / `stage`                                  |
| `ADOBE_IMS_AUTO_REFRESH` | silent refresh toggle                             |
| `AUTH_SESSION_SECRET`    | `openssl rand -hex 32` — encrypts the token store |

## Notes for agents

- This template's `middleware.ts` **overwrites `auth-mock`'s dev middleware** and runs real
  IMS auth + auto-refresh on `{protected_paths}`.
- `AUTH_MODE=mock` short-circuits both the middleware and `getCurrentUser()` to `MOCK_USER`
  for local dev; set `AUTH_MODE=real` (or unset) for the real flow.
- Mutually exclusive with every other auth provider (declared `conflicts`).

## Checklist (post-install)

Merge `.env.adobe-ims.example`; set `ADOBE_IMS_CLIENT_ID` (SPA credential); generate
`AUTH_SESSION_SECRET`; choose `AUTH_MODE`; test the login→callback→`/dashboard` flow; verify
`/api/auth/me` and logout; confirm middleware redirects on protected paths; use
`getCurrentUser()` / `requireAuth()` in Server Components/Actions.

## Related

Prerequisites: [`shared-types`](../shared-types), [`auth-mock`](../auth-mock),
[`env-setup`](../env-setup). Not related to the Firefly Server-to-Server auth in
[`adobe-firefly-core`](../adobe-firefly-core).
