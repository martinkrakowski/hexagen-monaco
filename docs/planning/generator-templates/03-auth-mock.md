# Template: Auth Mock

**Branch:** `feature/auth-stack-restructure`
**Status:** Implemented (v2.0). Trimmed scope per the auth-stack-restructure plan.

## Purpose

Foundation layer for every other auth template. Owns three things and no more:

1. The **UserContext** domain value object (the shape every other auth concern speaks).
2. A configurable **MOCK_USER** constant for development.
3. A **dev-only root middleware** that injects MOCK_USER as `x-user-context` whenever `AUTH_MODE=mock`.

It also ships generic AES-256-GCM session-cookie helpers (`readSessionToken`, `buildSessionCookieHeader`, `buildClearSessionCookieHeader`) that real providers reuse. That's the whole template.

What it **does not** do anymore (compared to v1):

- No `AuthProviderPort` contract — each provider owns its own middleware end-to-end.
- No `RealAuthAdapter` stub — there is no abstract slot to wire into.
- No `auth.service` / `getCurrentUserUseCase` — providers expose `getCurrentUser()` directly.
- No `protected_paths` question — protection is provider-specific.

---

## Install-Time Questions

| ID                    | Prompt                                         | Type | Default            |
| --------------------- | ---------------------------------------------- | ---- | ------------------ |
| `session_cookie_name` | Session cookie name? (used by session helpers) | text | `__auth_session`   |
| `mock_user_name`      | Mock user display name?                        | text | `Demo User`        |
| `mock_user_email`     | Mock user email?                               | text | `demo@example.com` |
| `mock_user_roles`     | Mock user roles (comma-separated)?             | text | `user`             |

---

## Files Generated

```
src/
  domain/
    value-objects/
      user-context.ts              # UserContext interface + hasRole helper
  infrastructure/
    auth/
      mock-user.ts                 # MOCK_USER constant, env-overridable
      session/
        session-manager.ts         # Generic readSessionToken + cookie builders
middleware.ts                      # Dev-only AUTH_MODE=mock short-circuit
.env.auth.example
```

---

## Behaviour

`middleware.ts` (root):

```ts
if (process.env.AUTH_MODE !== "mock") return NextResponse.next();
// else: attach JSON.stringify(MOCK_USER) as x-user-context, pass through.
```

Real providers ship their own root `middleware.ts` that **overwrites this file** during generation (the cross-template `wasGeneratedByHexagen` override from PR #106). Their middleware still honours `AUTH_MODE=mock` as a dev short-circuit.

---

## Environment Variables

```
AUTH_MODE=mock                  # mock | real (unset = real)
AUTH_COOKIE_NAME=__auth_session # consumed by session-manager helpers
AUTH_SESSION_MAX_AGE=604800     # cookie Max-Age in seconds (7d default)
MOCK_USER_ID=...
MOCK_USER_NAME=...              # runtime override of install-time default
MOCK_USER_EMAIL=...
MOCK_USER_ROLES=user,admin
MOCK_USER_AVATAR_URL=
```

Real-provider secrets (e.g. `AUTH_SESSION_SECRET` for AES encryption) are configured by the provider template that needs them — auth-mock does not require them.

---

## How Providers Build On This

A provider template (`google-oauth`, `supabase`, etc.):

1. `requires: ["auth-mock", "env-setup"]` — so MOCK_USER + UserContext are present.
2. Ships its own `middleware.ts` (overwrites the dev middleware).
3. Ships `src/lib/auth/get-current-user.ts` and `require-auth.ts` that honour `AUTH_MODE=mock` by returning MOCK_USER directly.
4. Ships its own login/callback/logout routes.
5. Reuses `session-manager.ts` cookie helpers for the AES-encrypted session cookie (except adobe-ims, which has its own token-store cookie scheme).

A single install can have at most one real provider — all five Group A providers + Supabase (with `auth` feature) declare mutual `conflicts`. The wizard's `findConflicts` enforces this symmetrically.
