# Templates: OAuth & Auth Providers

**Replaces:** `04-adobe-ims-spa.md`

---

## Overview

Covers 8 auth provider templates catalogued in the UI add-ons wizard. Split into two integration patterns:

| Group                         | Pattern                                                                                    | Templates                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **A — Provider Adapters**     | Extend `auth-mock`; fill in `AuthProviderPort`; share `UserContext` + session cookie layer | Adobe IMS SPA, Google OAuth, GitHub OAuth, Microsoft Entra, Magic Link |
| **B — Standalone Frameworks** | Replace the auth layer entirely; own their own session management                          | Auth.js (NextAuth v5), Clerk, Better Auth                              |

Group A providers conflict with Group B frameworks but are compatible with each other. Group B frameworks all conflict with each other and with every Group A provider.

---

## Branching Strategy

Each template is a separate directory under `packages/template-engine/templates/`. Recommended: one branch + PR per template so review bots can give focused feedback. Branch names:

| Template ID       | Branch                                       |
| ----------------- | -------------------------------------------- |
| `adobe-ims-spa`   | `feature/generator-template-adobe-ims-spa`   |
| `google-oauth`    | `feature/generator-template-google-oauth`    |
| `github-oauth`    | `feature/generator-template-github-oauth`    |
| `microsoft-entra` | `feature/generator-template-microsoft-entra` |
| `magic-link`      | `feature/generator-template-magic-link`      |
| `nextauth`        | `feature/generator-template-nextauth`        |
| `clerk`           | `feature/generator-template-clerk`           |
| `better-auth`     | `feature/generator-template-better-auth`     |

---

## Common Design Patterns — Group A

All Group A templates share these architectural decisions:

**`UserContext` is the output.** After any login flow, the provider adapter maps the provider's user object to `UserContext` (from `03-auth-mock`). All application code sees only `UserContext` — it does not know which provider issued it.

**Fills in `real-auth.adapter.stub.ts`.** Each Group A template implements `AuthProviderPort` and replaces the stub with a concrete adapter. Setting `AUTH_MODE=real` activates it.

**Session cookie is the only browser artefact.** Access tokens, refresh tokens, and PKCE verifiers never leave the server. The browser only ever holds the `__auth_session` cookie.

**Token storage is pluggable** (where applicable). Adapters that issue long-lived tokens (Adobe IMS, Google, Entra) support `httponly-cookie` (default), `server-session`, and `supabase` storage backends.

---

## A1 — Adobe IMS SPA (PKCE)

**Template ID:** `adobe-ims-spa`  
**Requires:** `auth-mock`, `env-setup`  
**Conflicts:** `nextauth`, `clerk`, `better-auth`

### Purpose

Modern Adobe IMS authentication using the Single Page App + PKCE credential type — the current Adobe-recommended approach after the OAuth Web App flow was deprecated. Produces login, callback, and logout routes, a token store, and automatic refresh handling.

### Install-Time Questions

| ID              | Prompt                                        | Type        | Options                                                                    | Default                                   |
| --------------- | --------------------------------------------- | ----------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| `client_id`     | Adobe IMS Client ID (from Developer Console)? | text        | —                                                                          | _(required)_                              |
| `redirect_uri`  | OAuth callback URI?                           | text        | —                                                                          | `http://localhost:3000/api/auth/callback` |
| `scopes`        | IMS scopes?                                   | multiselect | `openid`, `AdobeID`, `read_organizations`, `firefly_api`, `creative_cloud` | `openid,AdobeID`                          |
| `environment`   | IMS environment?                              | select      | `prod`, `stage`                                                            | `prod`                                    |
| `token_storage` | Where to store tokens?                        | select      | `httponly-cookie`, `server-session`, `supabase`                            | `httponly-cookie`                         |
| `auto_refresh`  | Auto-refresh access tokens before expiry?     | boolean     | —                                                                          | `true`                                    |
| `user_profile`  | Fetch Adobe user profile after login?         | boolean     | —                                                                          | `true`                                    |

### Files Generated

```
src/infrastructure/auth/adobe-ims/
  config.ts                   # IMS URLs, client ID, scopes — fails fast if CLIENT_ID absent
  pkce.ts                     # verifier + challenge via Web Crypto; buildAuthorizeUrl()
  ims-client.ts               # exchangeCode(), refreshToken(), fetchProfile()
  token-store.ts              # CookieTokenStore (AES-256-GCM) | SupabaseTokenStore
  user-profile-mapper.ts      # IMSUserProfile → UserContext
  adobe-ims-auth.adapter.ts   # Implements AuthProviderPort

src/domain/ports/out/
  ims-auth.port.ts            # IMSAuthPort + IMSTokens + IMSUserProfile types

app/api/auth/
  login/route.ts              # GET → PKCE pair, store verifier cookie, redirect to IMS
  callback/route.ts           # GET → CSRF + verifier check, code exchange, session creation
  logout/route.ts             # POST → token revoke, cookie clear
  me/route.ts                 # GET → current UserContext (replaces auth-mock stub)

.env.adobe-ims.example
```

### .env Variables

```env
ADOBE_IMS_CLIENT_ID=
ADOBE_IMS_REDIRECT_URI=http://localhost:3000/api/auth/callback
ADOBE_IMS_SCOPES=openid,AdobeID
ADOBE_IMS_ENVIRONMENT=prod          # prod | stage
AUTH_SESSION_SECRET=                # openssl rand -hex 32
```

### Key Design Decisions

- PKCE verifier generated with `crypto.getRandomValues()` (128 bytes, base64url-encoded); stored in a 300s httpOnly cookie during the redirect cycle
- `CookieTokenStore` encrypts tokens with AES-256-GCM using `AUTH_SESSION_SECRET`; browser never sees raw tokens
- Auto-refresh middleware runs before auth middleware: if `expiresAt - now < 300s`, silently refreshes; on failure, clears session and returns 401

---

## A2 — Google OAuth 2.0

**Template ID:** `google-oauth`  
**Requires:** `auth-mock`, `env-setup`  
**Conflicts:** `nextauth`, `clerk`, `better-auth`

### Purpose

Server-side Google OAuth 2.0 integration. Handles the full authorization code flow, verifies the ID token via `google-auth-library`, and hydrates a typed `GoogleUser` into the session.

### Install-Time Questions

| ID              | Prompt                                        | Type        | Options                      | Default                                          |
| --------------- | --------------------------------------------- | ----------- | ---------------------------- | ------------------------------------------------ |
| `client_id`     | Google OAuth Client ID?                       | text        | —                            | _(required)_                                     |
| `client_secret` | Google OAuth Client Secret?                   | text        | —                            | _(required)_                                     |
| `redirect_uri`  | OAuth callback URI?                           | text        | —                            | `http://localhost:3000/api/auth/callback/google` |
| `scopes`        | OAuth scopes?                                 | multiselect | `openid`, `email`, `profile` | `openid,email,profile`                           |
| `hd`            | Restrict to hosted domain (e.g. company.com)? | text        | —                            | _(optional)_                                     |

### Files Generated

```
src/infrastructure/auth/google/
  config.ts                   # Client ID, secret, redirect URI — fails fast if absent
  google-client.ts            # OAuth2Client setup, buildAuthorizeUrl(), exchangeCode(), verifyIdToken()
  user-profile-mapper.ts      # Google profile → UserContext + GoogleUser value object
  google-auth.adapter.ts      # Implements AuthProviderPort

src/domain/value-objects/
  google-user.ts              # Typed GoogleUser (sub, email, name, picture, hd)

app/api/auth/
  login/google/route.ts       # GET → state cookie, redirect to Google
  callback/google/route.ts    # GET → CSRF check, code exchange, ID token verify, session

.env.google-oauth.example
```

### .env Variables

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback/google
GOOGLE_OAUTH_SCOPES=openid,email,profile
GOOGLE_HD=                          # optional: restrict to a hosted domain
AUTH_SESSION_SECRET=                # shared with auth-mock
```

### Key Design Decisions

- ID token verification via `google-auth-library` `OAuth2Client.verifyIdToken()` — never trusts payload from token exchange response directly
- CSRF state: random UUID stored in a 300s httpOnly cookie, validated on callback
- `hd` claim checked post-verification to enforce hosted domain restriction without an extra API call

---

## A3 — GitHub OAuth

**Template ID:** `github-oauth`  
**Requires:** `auth-mock`, `env-setup`  
**Conflicts:** `nextauth`, `clerk`, `better-auth`

### Purpose

Lightweight GitHub OAuth App integration. Exchanges the authorization code for an access token, fetches the user profile and primary email (separate API call — email may not be public), and writes a typed `GitHubUser` into the session.

### Install-Time Questions

| ID              | Prompt                                            | Type        | Options                               | Default                                          |
| --------------- | ------------------------------------------------- | ----------- | ------------------------------------- | ------------------------------------------------ |
| `client_id`     | GitHub OAuth App Client ID?                       | text        | —                                     | _(required)_                                     |
| `client_secret` | GitHub OAuth App Client Secret?                   | text        | —                                     | _(required)_                                     |
| `redirect_uri`  | OAuth callback URI?                               | text        | —                                     | `http://localhost:3000/api/auth/callback/github` |
| `scopes`        | OAuth scopes?                                     | multiselect | `read:user`, `user:email`, `read:org` | `read:user,user:email`                           |
| `allowed_orgs`  | Restrict to GitHub org members (comma-separated)? | text        | —                                     | _(optional)_                                     |

### Files Generated

```
src/infrastructure/auth/github/
  config.ts                   # App credentials, redirect URI
  github-client.ts            # buildAuthorizeUrl(), exchangeCode(), fetchUser(), fetchEmail()
  user-profile-mapper.ts      # GitHub profile → UserContext + GitHubUser value object
  github-auth.adapter.ts      # Implements AuthProviderPort

src/domain/value-objects/
  github-user.ts              # Typed GitHubUser (id, login, name, email, avatar_url, company)

app/api/auth/
  login/github/route.ts       # GET → state cookie, redirect to GitHub
  callback/github/route.ts    # GET → CSRF check, code exchange, profile fetch, session

.env.github-oauth.example
```

### .env Variables

```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/callback/github
GITHUB_OAUTH_SCOPES=read:user,user:email
GITHUB_ALLOWED_ORGS=            # optional: comma-separated org names
AUTH_SESSION_SECRET=
```

### Key Design Decisions

- Email is fetched from `/user/emails` (not `/user`) and the primary, verified email is used; handles the case where a user's email is set to private
- Org membership check via `/orgs/{org}/members/{username}` when `allowed_orgs` is set — returns 403 if not a member
- No long-lived token storage needed: GitHub access tokens don't expire (for OAuth Apps); stored in session cookie only

---

## A4 — Microsoft Entra (MSAL)

**Template ID:** `microsoft-entra`  
**Requires:** `auth-mock`, `env-setup`  
**Conflicts:** `nextauth`, `clerk`, `better-auth`

### Purpose

Microsoft Entra ID (Azure AD) integration using `@azure/msal-node`. Supports confidential-client authorization code flow with PKCE, in-memory token caching with silent refresh, and maps AAD group claims to application roles.

### Install-Time Questions

| ID                   | Prompt                                | Type    | Options | Default                                         |
| -------------------- | ------------------------------------- | ------- | ------- | ----------------------------------------------- |
| `tenant_id`          | Azure Tenant ID?                      | text    | —       | _(required)_                                    |
| `client_id`          | Azure App Registration Client ID?     | text    | —       | _(required)_                                    |
| `client_secret`      | Azure App Registration Client Secret? | text    | —       | _(required)_                                    |
| `redirect_uri`       | OAuth callback URI?                   | text    | —       | `http://localhost:3000/api/auth/callback/entra` |
| `scopes`             | API scopes?                           | text    | —       | `openid,profile,email,User.Read`                |
| `group_role_mapping` | Map AAD group object IDs to roles?    | boolean | —       | `false`                                         |

### Files Generated

```
src/infrastructure/auth/entra/
  config.ts                   # MSAL ConfidentialClientApplication configuration
  msal-client.ts              # Singleton MSAL client, acquireTokenByCode(), acquireTokenSilent()
  token-cache.ts              # In-memory MSAL cache serialiser (pluggable)
  group-role-mapper.ts        # AAD group object IDs → application role strings
  user-profile-mapper.ts      # Entra profile → UserContext + EntraUser value object
  entra-auth.adapter.ts       # Implements AuthProviderPort

src/domain/value-objects/
  entra-user.ts               # Typed EntraUser (oid, upn, displayName, groups, roles)

app/api/auth/
  login/entra/route.ts        # GET → MSAL auth URL, state cookie
  callback/entra/route.ts     # GET → acquireTokenByCode, group resolution, session
  logout/entra/route.ts       # POST → MSAL logout + session clear

.env.microsoft-entra.example
```

### .env Variables

```env
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
ENTRA_CLIENT_SECRET=
ENTRA_REDIRECT_URI=http://localhost:3000/api/auth/callback/entra
ENTRA_SCOPES=openid,profile,email,User.Read
# Optional: JSON map of group object IDs to role names
# ENTRA_GROUP_ROLE_MAP={"<group-object-id>":"admin","<group-object-id>":"editor"}
AUTH_SESSION_SECRET=
```

### Key Design Decisions

- Uses `ConfidentialClientApplication` (server-side) with PKCE — not the browser MSAL library
- Token cache is in-memory by default; the `token-cache.ts` serialiser interface allows Redis/Supabase persistence
- Group object IDs (not display names) used for role mapping — display names can change without notice
- AAD group claims are only present in the token if the app manifest `groupMembershipClaims` is set to `All` or `SecurityGroup`; the stub warns if not configured

---

## A5 — Magic Link (Passwordless)

**Template ID:** `magic-link`  
**Requires:** `auth-mock`, `env-setup`  
**Conflicts:** `nextauth`, `clerk`, `better-auth`

### Purpose

Passwordless email authentication using short-lived HMAC-signed tokens. Supports Resend (default) and Nodemailer as email transports. Tokens are single-use and expire after a configurable TTL.

### Install-Time Questions

| ID                  | Prompt                                    | Type   | Options                | Default                 |
| ------------------- | ----------------------------------------- | ------ | ---------------------- | ----------------------- |
| `email_transport`   | Email transport?                          | select | `resend`, `nodemailer` | `resend`                |
| `from_address`      | From address for magic link emails?       | text   | —                      | `noreply@example.com`   |
| `token_ttl_minutes` | Magic link expiry (minutes)?              | select | `5`, `10`, `15`, `30`  | `15`                    |
| `app_url`           | Application base URL for link generation? | text   | —                      | `http://localhost:3000` |

### Files Generated

```
src/infrastructure/auth/magic-link/
  config.ts                   # TTL, from address, app URL
  token-generator.ts          # HMAC-SHA256 signed token with embedded expiry + email
  email-transport.ts          # Resend / Nodemailer abstraction (selected at install time)
  email-templates.ts          # HTML + text email body for the magic link
  magic-link-store.ts         # Used-token store (in-memory; swap for Redis/DB)
  user-profile-mapper.ts      # Email → UserContext (roles default to ['user'])
  magic-link-auth.adapter.ts  # Implements AuthProviderPort

app/api/auth/
  magic-link/request/route.ts # POST { email } → generate token, send email, 200
  magic-link/verify/route.ts  # GET ?token=... → validate, single-use check, session
  logout/route.ts             # DELETE → clear session

.env.magic-link.example
```

### .env Variables

```env
MAGIC_LINK_SECRET=              # openssl rand -hex 32 — signs tokens
MAGIC_LINK_TTL_MINUTES=15
MAGIC_LINK_FROM=noreply@example.com
APP_URL=http://localhost:3000

# Resend (default transport)
RESEND_API_KEY=

# Nodemailer (alternative transport)
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
AUTH_SESSION_SECRET=
```

### Key Design Decisions

- Token format: `base64url(email + expiry)` + `.` + HMAC-SHA256 signature — self-contained, no DB lookup needed to validate (only for replay protection)
- Single-use store tracks consumed token hashes (in-memory default, bounded to 10k entries with LRU eviction); interface allows Redis/Upstash
- No user account required: `UserContext` is synthesised from the verified email with default roles; downstream apps can extend roles via middleware

---

## B1 — Auth.js (NextAuth v5)

**Template ID:** `nextauth`  
**Requires:** `env-setup`  
**Conflicts:** `google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`, `adobe-ims-spa`, `clerk`, `better-auth`

### Purpose

Full Auth.js v5 (NextAuth) setup with Google, GitHub, and Credentials providers pre-wired, JWT session strategy, typed `session.user`, and a middleware file that protects routes based on matcher patterns. Standalone — does NOT use `auth-mock` or `AuthProviderPort`.

### Install-Time Questions

| ID                 | Prompt                                  | Type        | Options                                    | Default                     |
| ------------------ | --------------------------------------- | ----------- | ------------------------------------------ | --------------------------- |
| `providers`        | Which providers?                        | multiselect | `google`, `github`, `credentials`, `email` | `google,github`             |
| `session_strategy` | Session strategy?                       | select      | `jwt`, `database`                          | `jwt`                       |
| `protected_paths`  | Path prefixes to protect?               | text        | —                                          | `/dashboard,/api/protected` |
| `trust_host`       | Trust HOST header (needed for proxies)? | boolean     | —                                          | `false`                     |

### Files Generated

```
src/
  auth.ts                     # Auth.js config: providers, callbacks, session typing
  auth.config.ts              # Split config for Edge-compatible middleware use
  types/next-auth.d.ts        # Session type augmentation for typed session.user

middleware.ts                 # Exported auth() middleware with matcher config

app/api/auth/
  [...nextauth]/route.ts      # Catch-all Auth.js handler

.env.nextauth.example
```

### .env Variables

```env
AUTH_SECRET=                    # openssl rand -base64 32
AUTH_URL=http://localhost:3000  # Required in production

# Google provider
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# GitHub provider
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
```

### Key Design Decisions

- Config split into `auth.config.ts` (Edge-safe, no DB imports) and `auth.ts` (full config with adapters) following the Auth.js v5 recommended pattern for Next.js middleware
- JWT strategy is default; database strategy adds a `@auth/prisma-adapter` import stub
- Credentials provider includes a bcrypt password check stub with a clear `// TODO: replace with your user lookup` comment

---

## B2 — Clerk

**Template ID:** `clerk`  
**Requires:** `env-setup`  
**Conflicts:** `google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`, `adobe-ims-spa`, `nextauth`, `better-auth`

### Purpose

Full Clerk integration: middleware, server-side auth helpers, `useUser`/`useAuth` React hooks examples, a JWT template for authenticating API routes, and organisation-aware role guards. Standalone — Clerk manages its own session entirely.

### Install-Time Questions

| ID                | Prompt                             | Type    | Options | Default                     |
| ----------------- | ---------------------------------- | ------- | ------- | --------------------------- |
| `protected_paths` | Path prefixes to protect?          | text    | —       | `/dashboard,/api/protected` |
| `org_features`    | Enable organisation/role features? | boolean | —       | `false`                     |
| `jwt_template`    | JWT template name for API auth?    | text    | —       | `default`                   |

### Files Generated

```
middleware.ts                         # clerkMiddleware() with route matcher

src/lib/
  auth.ts                             # currentUser(), auth() server helpers re-exported
  role-guard.tsx                      # <RoleGuard role="admin"> wrapper component

app/
  (protected)/
    layout.tsx                        # Server component: redirect if not signed in
  api/
    protected-example/route.ts        # API route using getAuth() + JWT template verify

.env.clerk.example
```

### .env Variables

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
```

### Key Design Decisions

- Only generates wiring code + usage examples; Clerk's own hosted UI handles all identity screens — no login page generated
- `RoleGuard` uses `useAuth().orgRole` for org-level gates and `sessionClaims.metadata.role` for custom app-level roles
- JWT template verify example shows how to protect a backend API that Clerk does not own (e.g., an external service)

---

## B3 — Better Auth

**Template ID:** `better-auth`  
**Requires:** `env-setup`  
**Conflicts:** `google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`, `adobe-ims-spa`, `nextauth`, `clerk`

### Purpose

Better Auth server setup with email/password, social providers (Google + GitHub), the magic-link plugin, and database schema migration helpers. Exports a typed `authClient` for both browser and server use. Standalone — Better Auth manages sessions natively.

### Install-Time Questions

| ID                    | Prompt                                     | Type        | Options                                            | Default                 |
| --------------------- | ------------------------------------------ | ----------- | -------------------------------------------------- | ----------------------- |
| `providers`           | Which providers?                           | multiselect | `email-password`, `google`, `github`, `magic-link` | `email-password,google` |
| `database`            | Database adapter?                          | select      | `prisma`, `drizzle`, `kysely`                      | `prisma`                |
| `session_expiry_days` | Session expiry (days)?                     | select      | `1`, `7`, `30`                                     | `7`                     |
| `rate_limiting`       | Enable Better Auth built-in rate limiting? | boolean     | —                                                  | `true`                  |

### Files Generated

```
src/lib/
  auth.ts                     # Better Auth server instance with plugins + providers
  auth-client.ts              # Typed createAuthClient() for browser + server components

app/api/auth/
  [...all]/route.ts           # Better Auth catch-all handler

src/db/
  schema/
    better-auth.ts            # Better Auth schema (users, sessions, accounts, verifications)
  migrations/
    0001_better_auth.sql      # Generated migration (adapter-specific)

.env.better-auth.example
```

### .env Variables

```env
BETTER_AUTH_SECRET=             # openssl rand -hex 32
BETTER_AUTH_URL=http://localhost:3000

# Social providers (add as needed)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Email (for magic-link plugin)
# RESEND_API_KEY=
```

### Key Design Decisions

- `auth.ts` and `auth-client.ts` are the only two files application code needs to import — no raw Better Auth imports elsewhere
- Schema is generated via `npx @better-auth/cli generate` and output to `src/db/schema/better-auth.ts`; the migration SQL is pre-generated for the chosen adapter
- Rate limiting is the built-in Better Auth `rateLimit` plugin; conflicts with the standalone `rate-limiting` template are noted in the checklist

---

## Post-Install Checklists

Each template generates its own `.env.*.example` and checklist. Common to all Group A templates:

1. Copy `.env.*.example` → `.env.local`
2. Set all `_CLIENT_ID` / `_CLIENT_SECRET` / `_API_KEY` values
3. Verify redirect URI matches exactly (scheme, host, path, trailing slash)
4. Generate `AUTH_SESSION_SECRET`: `openssl rand -hex 32`
5. Set `AUTH_MODE=real` in `src/infrastructure/auth/index.ts`

Common to all Group B templates:

1. Copy `.env.*.example` → `.env.local`
2. Set provider credentials
3. Generate framework secret (`AUTH_SECRET` / `BETTER_AUTH_SECRET`)
4. Run schema migration (Better Auth) or verify Clerk keys (Clerk)

---

## Template Dependencies Summary

```
env-setup
  └── auth-mock
        ├── adobe-ims-spa
        ├── google-oauth
        ├── github-oauth
        ├── microsoft-entra
        └── magic-link

env-setup
  ├── nextauth       (standalone)
  ├── clerk          (standalone)
  └── better-auth    (standalone)
```

Group A templates can coexist (e.g. Adobe IMS + Google OAuth for a multi-provider app). Group B templates cannot coexist with anything — they own the entire auth layer.
