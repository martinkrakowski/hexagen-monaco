# Template: Auth Mock

**Branch:** `feature/generator-template-auth-mock`

## Purpose

Generates a togglable authentication layer with a mock mode that returns a configurable hardcoded user, and a real mode slot ready for a concrete auth provider. Prevents projects from starting fully anonymous and makes demos work without real credentials.

---

## Install-Time Questions

| ID                    | Prompt                                       | Type   | Options                                                             | Default            |
| --------------------- | -------------------------------------------- | ------ | ------------------------------------------------------------------- | ------------------ |
| `session_cookie_name` | Session cookie name?                         | text   | —                                                                   | `__auth_session`   |
| `cookie_max_age_days` | Session duration (days)?                     | select | `1`, `7`, `30`                                                      | `7`                |
| `mock_user_name`      | Mock user display name?                      | text   | —                                                                   | `Demo User`        |
| `mock_user_email`     | Mock user email?                             | text   | —                                                                   | `demo@example.com` |
| `mock_user_roles`     | Mock user roles (comma-separated)?           | text   | —                                                                   | `user`             |
| `protected_paths`     | Paths to protect (comma-separated prefix)?   | text   | —                                                                   | `/api,/dashboard`  |
| `real_provider_slot`  | Which real provider will replace mock later? | select | `adobe-ims`, `nextauth`, `clerk`, `supabase-auth`, `custom`, `none` | `none`             |

---

## Files Generated

```
src/
  domain/
    value-objects/
      user-context.ts             # UserContext value object
    ports/
      out/
        auth-provider.port.ts     # AuthProviderPort interface
  application/
    use-cases/
      get-current-user.use-case.ts
    services/
      auth.service.ts             # Wraps port; used by middleware + routes
  infrastructure/
    auth/
      mock/
        mock-auth.adapter.ts      # Returns hardcoded user from env
        mock-session.ts           # Mints + reads session cookie
      real/
        real-auth.adapter.stub.ts # Commented stub for real provider
      session/
        session-manager.ts        # Framework-agnostic session read/write
      index.ts

server/
  middleware/
    auth.middleware.ts            # Reads session; injects UserContext into request

app/
  api/
    auth/
      logout/
        route.ts                  # DELETE → clears session cookie

.env.auth.example
```

---

## Generated .env Variables

```env
# Authentication
AUTH_MODE=mock                  # mock | real
AUTH_SESSION_SECRET=            # Required in real mode; generate with: openssl rand -hex 32
AUTH_SESSION_MAX_AGE=604800     # 7 days in seconds
AUTH_COOKIE_NAME=__auth_session

# Mock User (only used when AUTH_MODE=mock)
MOCK_USER_ID=usr_demo_001
MOCK_USER_NAME=Demo User
MOCK_USER_EMAIL=demo@example.com
MOCK_USER_ROLES=user
MOCK_USER_AVATAR_URL=
```

---

## Key Design Decisions

**`AUTH_MODE` toggle is the single switch:** All downstream code reads `UserContext` from the request — it doesn't know or care whether the session came from a mock or a real IDP. Switching modes is a one-line env var change.

**`UserContext` is a value object, not a database entity:** It carries `id`, `email`, `name`, `roles`, and `avatarUrl`. It is not persisted; it is reconstructed from the session on every request. This keeps the domain clean.

**Session cookie is opaque:** In mock mode, the session payload is a Base64-encoded JSON of `UserContext`. In real mode, it's a signed JWT or an opaque token — the `SessionManager` abstracts this. No application code changes when switching.

**Logout is the only auth route in mock mode:** There is no login route in mock mode (the session is auto-minted on first request). The logout route deletes the cookie. This is intentional — demos should not require a login step unless explicitly needed.

---

## Phase 1 — UserContext Value Object

**Goal:** Define the shape of an authenticated user throughout the application.

```typescript
// src/domain/value-objects/user-context.ts
export interface UserContext {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: ReadonlyArray<string>;
  readonly avatarUrl?: string;
}

export function hasRole(user: UserContext, role: string): boolean {
  return user.roles.includes(role);
}
```

Validation: Unit test for `hasRole` with single and multiple roles.

---

## Phase 2 — AuthProviderPort Interface

**Goal:** Define the contract both mock and real adapters must satisfy.

```typescript
// src/domain/ports/out/auth-provider.port.ts
export interface AuthProviderPort {
  /** Validate a session token and return the associated user, or null if invalid. */
  validate(sessionToken: string): Promise<UserContext | null>;
  /** Mint a new session token for the given user. */
  createSession(user: UserContext): Promise<string>;
  /** Invalidate a session token. */
  revokeSession(sessionToken: string): Promise<void>;
}
```

Validation: TypeScript compiles; no implementation yet.

---

## Phase 3 — Mock Auth Adapter

**Goal:** Fully working mock that returns the env-configured user.

`mock-auth.adapter.ts`:

- `validate()` → returns `MOCK_USER` if token is `'mock-session'`, else `null`
- `createSession()` → returns `'mock-session'` (deterministic, no real crypto)
- `revokeSession()` → no-op

`mock-session.ts`:

- On every request: check for `__auth_session` cookie
- If absent: call `adapter.createSession(MOCK_USER)`, set cookie, attach user to request
- If present and valid: attach user to request
- Logout route: call `adapter.revokeSession()`, clear cookie

Validation: Integration test — first request sets cookie; second request reads same user; logout clears cookie.

---

## Phase 4 — AuthService & Middleware

**Goal:** Single service used by all routes; middleware injects `UserContext` into request context.

```typescript
// src/application/services/auth.service.ts
export class AuthService {
  constructor(private readonly provider: AuthProviderPort) {}

  async getCurrentUser(sessionToken: string): Promise<UserContext | null> { ... }
  async requireUser(sessionToken: string): Promise<UserContext> { ... } // throws AuthenticationError
}
```

Middleware:

- Extracts session cookie
- Calls `AuthService.getCurrentUser()`
- Attaches `UserContext` to `request.user` (or framework-specific context)
- If path is protected and no user: returns 401

Validation: Middleware test — protected path without cookie returns 401; with cookie returns 200 + user context.

---

## Phase 5 — GetCurrentUser Use Case

**Goal:** Application-layer use case for reading the authenticated user.

```typescript
// src/application/use-cases/get-current-user.use-case.ts
export class GetCurrentUserUseCase {
  execute(ctx: RequestContext): UserContext | null;
}
```

This is the canonical way for feature use cases to access the current user — they depend on this use case, not on the HTTP layer directly.

Validation: Unit test with mock request context.

---

## Phase 6 — Real Provider Stub

**Goal:** Pre-wired placeholder for the real auth provider, ready to implement.

`real-auth.adapter.stub.ts`:

- Implements `AuthProviderPort`
- Every method throws `NotImplementedError` with a descriptive message
- Contains a comment block explaining what to implement based on `real_provider_slot` answer

If `real_provider_slot === 'adobe-ims'`: comment points to `04-adobe-ims-spa.md`
If `real_provider_slot === 'supabase-auth'`: comment points to `05-supabase.md`

Switching from mock to real:

1. Set `AUTH_MODE=real`
2. Implement `real-auth.adapter.stub.ts`
3. Register it in the DI container instead of `mock-auth.adapter.ts`

Validation: TypeScript compiles; stub methods throw with helpful messages.

---

## Post-Install Checklist

```
✅ auth-mock installed

Next steps:
  1. Merge .env.auth.example into your .env.local
  2. Set AUTH_MODE=mock for local development
  3. Customize MOCK_USER_NAME, MOCK_USER_EMAIL, and MOCK_USER_ROLES
  4. Verify __auth_session cookie is set on first browser request
  5. Call GET /api/auth/me (generated) to confirm UserContext is returned
  6. When ready for real auth: see template 04-adobe-ims-spa or 05-supabase
```

---

## Template Dependencies

- Soft dependency: `env-setup` (for `AUTH_SESSION_SECRET` validation)
- Soft dependency: `rate-limiting` (if rate-limiting per user ID rather than per session)
- Extended by: `adobe-ims-spa`, `supabase` (those templates fill in the real provider stub)
