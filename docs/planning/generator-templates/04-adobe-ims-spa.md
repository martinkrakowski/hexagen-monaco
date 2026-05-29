# Template: Adobe IMS SPA (PKCE)

**Branch:** `feature/generator-template-adobe-ims-spa`

## Purpose

Generates a modern Adobe IMS authentication flow using the Single Page App + PKCE pattern — the current recommended approach after the OAuth Web App flow was deprecated. Produces ready-to-use login, callback, and logout routes, a token store, and automatic refresh handling.

---

## Install-Time Questions

| ID              | Prompt                                        | Type        | Options                                                                    | Default                                   |
| --------------- | --------------------------------------------- | ----------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| `client_id`     | Adobe IMS Client ID (from Developer Console)? | text        | —                                                                          | _(required)_                              |
| `redirect_uri`  | OAuth callback URI?                           | text        | —                                                                          | `http://localhost:3000/api/auth/callback` |
| `scopes`        | IMS scopes?                                   | multiselect | `openid`, `AdobeID`, `read_organizations`, `firefly_api`, `creative_cloud` | `openid,AdobeID`                          |
| `environment`   | IMS environment?                              | select      | `prod`, `stage`                                                            | `prod`                                    |
| `token_storage` | Where to store tokens?                        | select      | `httponly-cookie`, `server-session`, `supabase`                            | `httponly-cookie`                         |
| `auto_refresh`  | Auto-refresh access tokens before expiry?     | boolean     | —                                                                          | `true`                                    |
| `user_profile`  | Fetch Adobe user profile after login?         | boolean     | —                                                                          | `true`                                    |

---

## Files Generated

```
src/
  infrastructure/
    auth/
      adobe-ims/
        config.ts               # IMS URLs, client ID, scopes
        pkce.ts                 # verifier + challenge generation
        ims-client.ts           # Token exchange, refresh, profile fetch
        token-store.ts          # Storage adapter (cookie / session / supabase)
        user-profile-mapper.ts  # Maps IMS profile → UserContext

app/
  api/
    auth/
      login/
        route.ts                # GET → redirect to IMS authorize endpoint
      callback/
        route.ts                # GET → exchange code for tokens, set session
      logout/
        route.ts                # POST → revoke token, clear session
      me/
        route.ts                # GET → return current user profile

src/
  domain/
    ports/
      out/
        ims-auth.port.ts        # IMSAuthPort interface

.env.adobe-ims.example
```

---

## Generated .env Variables

```env
# Adobe IMS
ADOBE_IMS_CLIENT_ID=
ADOBE_IMS_REDIRECT_URI=http://localhost:3000/api/auth/callback
ADOBE_IMS_SCOPES=openid,AdobeID
ADOBE_IMS_ENVIRONMENT=prod     # prod | stage

# IMS Endpoints (auto-set from ENVIRONMENT, override only if needed)
# ADOBE_IMS_BASE_URL=https://ims-na1.adobelogin.com

# Token Storage
AUTH_SESSION_SECRET=            # openssl rand -hex 32
```

---

## Key Design Decisions

**PKCE, not client secret:** Single Page App credential type requires PKCE (no client secret in the browser or server env vars). The code verifier is generated per-login-attempt and stored in a short-lived httpOnly cookie during the redirect cycle.

**Tokens never touch the browser:** Even though this is an SPA-style credential type, the token exchange and storage happen server-side (Next.js API routes). The browser only sees a session cookie.

**Token storage is pluggable:** `httponly-cookie` (default) stores the encrypted access + refresh token in a signed cookie. `server-session` stores them in memory/Redis. `supabase` stores them in a `user_sessions` table. The application never reads tokens directly — it calls `getCurrentUser()` which abstracts the storage.

**UserContext is the output:** After login, the IMS user profile is mapped to a `UserContext` (from `03-auth-mock`). All application code continues to work with `UserContext` regardless of auth provider.

**Fills in the auth-mock real stub:** If `auth-mock` is installed, this template overwrites `real-auth.adapter.stub.ts` with a real `AdobeIMSAuthAdapter` and adds a note to switch `AUTH_MODE=real`.

---

## Phase 1 — IMS Configuration

**Goal:** Centralized, type-safe IMS endpoint and credential configuration.

```typescript
// src/infrastructure/auth/adobe-ims/config.ts
const BASE_URLS = {
  prod: "https://ims-na1.adobelogin.com",
  stage: "https://ims-na1-stg1.adobelogin.com",
} as const;

export const IMS_CONFIG = {
  clientId: process.env.ADOBE_IMS_CLIENT_ID!,
  redirectUri: process.env.ADOBE_IMS_REDIRECT_URI!,
  scopes: process.env.ADOBE_IMS_SCOPES?.split(",") ?? ["openid", "AdobeID"],
  baseUrl:
    BASE_URLS[
      (process.env.ADOBE_IMS_ENVIRONMENT as "prod" | "stage") ?? "prod"
    ],
} as const;
```

Validation: Startup check — throws `MissingConfigError` if `ADOBE_IMS_CLIENT_ID` is absent.

---

## Phase 2 — PKCE Utilities

**Goal:** Cryptographically correct code verifier + challenge generation.

```typescript
// src/infrastructure/auth/adobe-ims/pkce.ts
export async function generatePKCEPair(): Promise<{
  verifier: string;
  challenge: string;
}>;
export function buildAuthorizeUrl(challenge: string, state: string): URL;
```

- Verifier: 128 bytes of `crypto.getRandomValues()`, base64url-encoded (no padding)
- Challenge: SHA-256 of verifier, base64url-encoded
- State: random UUID for CSRF protection

Validation: Unit test — challenge derived from verifier matches expected SHA-256 output.

---

## Phase 3 — Login Route

**Goal:** Redirect user to IMS authorize endpoint with PKCE challenge.

`app/api/auth/login/route.ts`:

1. Generate PKCE pair
2. Store `verifier` in a short-lived httpOnly cookie (`__pkce_verifier`, `maxAge: 300s`)
3. Store `state` in a cookie (`__auth_state`, `maxAge: 300s`)
4. Build authorize URL with `challenge`, `state`, `client_id`, `redirect_uri`, `scopes`
5. Return `302` redirect

Validation: Integration test — response is 302 with `Location` header pointing to IMS; cookies are set.

---

## Phase 4 — Callback Route & Token Exchange

**Goal:** Exchange authorization code for access + refresh tokens.

`app/api/auth/callback/route.ts`:

1. Read `code` and `state` from query params
2. Validate `state` matches `__auth_state` cookie (CSRF check)
3. Read `verifier` from `__pkce_verifier` cookie
4. POST to IMS token endpoint: `grant_type=authorization_code`, `code`, `verifier`, `client_id`, `redirect_uri`
5. Store tokens via `TokenStore`
6. Clear PKCE cookies
7. Fetch user profile (if `user_profile=true`)
8. Create session via `AuthService.createSession()`
9. Redirect to `/dashboard`

```typescript
// ims-client.ts: exchangeCode(code: string, verifier: string): Promise<IMSTokens>
export interface IMSTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix timestamp
  tokenType: "bearer";
}
```

Validation: Integration test with mocked IMS token endpoint.

---

## Phase 5 — Token Store

**Goal:** Pluggable token persistence that keeps tokens off the browser.

`token-store.ts` interface:

```typescript
export interface TokenStore {
  save(sessionId: string, tokens: IMSTokens): Promise<void>;
  load(sessionId: string): Promise<IMSTokens | null>;
  revoke(sessionId: string): Promise<void>;
}
```

`CookieTokenStore` (default): Encrypts `IMSTokens` with AES-256-GCM using `AUTH_SESSION_SECRET`, stores in `__auth_tokens` httpOnly cookie.

`SupabaseTokenStore` (opt-in if supabase template present): Stores in `user_sessions` table with `session_id`, `encrypted_tokens`, `expires_at`.

Validation: Unit test for encrypt/decrypt round-trip; test for revoke clears store.

---

## Phase 6 — Auto-Refresh Middleware

**Goal:** Transparently refresh expired access tokens before they hit API routes.

Middleware (runs before auth middleware):

1. Load tokens for current session
2. If `tokens.expiresAt - now < 300` (within 5 minutes): refresh
3. POST to IMS refresh endpoint with `refresh_token`
4. Save new tokens; update session cookie expiry
5. On refresh failure (e.g., refresh token expired): clear session, return 401

Validation: Test with a token 4 minutes from expiry — assert refresh called; test with fresh token — assert no refresh.

---

## Phase 7 — User Profile Fetch & Mapping

**Goal:** Fetch Adobe user profile and map to `UserContext`.

`ims-client.ts: fetchProfile(accessToken: string): Promise<IMSUserProfile>`

IMS profile fields used:

- `userId` → `UserContext.id`
- `email` → `UserContext.email`
- `displayName` → `UserContext.name`
- `avatarUrl` (if present) → `UserContext.avatarUrl`
- Roles set to `['adobe-user']` by default; extend in `user-profile-mapper.ts` for org roles

Validation: Unit test for mapper with a real IMS profile fixture.

---

## Phase 8 — Auth-Mock Integration

**Goal:** Wire this template into the `auth-mock` real provider slot.

If `auth-mock` is installed:

1. Replace `real-auth.adapter.stub.ts` with `AdobeIMSAuthAdapter` implementing `AuthProviderPort`
2. Update `SETUP.md` with a section on switching `AUTH_MODE=real`
3. Add note: "Generate `AUTH_SESSION_SECRET` with `openssl rand -hex 32`"

Validation: TypeScript compiles with the real adapter; `AUTH_MODE=real` flow resolves a `UserContext`.

---

## Post-Install Checklist

```
✅ adobe-ims-spa installed

Next steps:
  1. Merge .env.adobe-ims.example into .env.local
  2. Set ADOBE_IMS_CLIENT_ID from the Adobe Developer Console
  3. Verify redirect URI matches exactly (http vs https, trailing slash)
  4. Confirm your credential type is "Single Page App" (not Web App — that's deprecated)
  5. Generate AUTH_SESSION_SECRET: openssl rand -hex 32
  6. Test login flow: GET /api/auth/login → IMS → callback → /dashboard
  7. See SETUP.md → Adobe IMS for org vs personal account licensing notes
```

---

## Template Dependencies

- Required: `auth-mock` (fills in the real provider stub)
- Soft dependency: `env-setup` (validates required IMS env vars at startup)
- Soft dependency: `supabase` (enables SupabaseTokenStore for token persistence)
