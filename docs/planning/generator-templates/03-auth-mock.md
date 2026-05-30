# Template: Auth Mock

**Branch:** `feature/shared-types-and-derived-answers`
**Status:** Implemented (v3.0). Slimmed to dev-middleware-only.

## Purpose

A dev-only root middleware that injects `MOCK_USER` (from `shared-types`) as the `x-user-context` header on every request when `AUTH_MODE=mock`. Real auth providers ship their own middleware that overwrites this one and still honours the same dev short-circuit.

What auth-mock **does** ship:

```text
middleware.ts            # AUTH_MODE=mock dev short-circuit + NODE_ENV guard
.env.auth.example
```

What auth-mock **no longer** ships (moved to `shared-types`):

- `src/domain/value-objects/user-context.ts` — UserContext interface + hasRole helper.
- `src/infrastructure/auth/mock-user.ts` — MOCK_USER constant (static defaults, env-overridable).
- `src/infrastructure/auth/session/session-manager.ts` — COOKIE_NAME (exported) + readSessionToken + buildSessionCookieHeader + buildClearSessionCookieHeader.

The MOCK*USER definition uses static defaults baked into code (`"Demo User"`, `"demo@example.com"`, `["user"]`). Runtime overrides via `MOCK_USER*_`env vars. There are **no`mock*user*_` install-time prompts\*\* — those were noise on every production OAuth install in v2.

---

## Install-Time Questions

| ID                    | Type | Notes                                            |
| --------------------- | ---- | ------------------------------------------------ |
| `session_cookie_name` | auto | Derived from `shared-types.session_cookie_name`. |

The `auto` type means the answer is resolved automatically from `shared-types`'s recorded answer; the user is never prompted for it. This is the first template in the registry to actually use `auto + derivedFrom` — it validates that schema feature end to end.

---

## Files Generated

```text
middleware.ts            # Dev-only AUTH_MODE=mock short-circuit
.env.auth.example
```

---

## Behaviour

`middleware.ts` (root):

```ts
const headers = new Headers(request.headers);
headers.delete("x-user-context"); // never trust client-supplied value
if (process.env.AUTH_MODE === "mock") {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("AUTH_MODE=mock is only supported in development");
  }
  headers.set("x-user-context", JSON.stringify(MOCK_USER));
}
return NextResponse.next({ request: { headers } });
```

Real providers ship their own root `middleware.ts` that **overwrites this file** during generation (the cross-template `wasGeneratedByHexagen` override from PR #106). Their middleware still honours `AUTH_MODE=mock` as a dev short-circuit.

---

## Dependencies

- `requires: ["shared-types", "env-setup"]`. The `shared-types` dep is **why** auth-mock can stay this small — `UserContext`, `MOCK_USER`, and the session-cookie helpers all live there.

---

## How providers build on this

A provider template:

1. `requires: ["shared-types", "auth-mock", "env-setup"]` — so UserContext, MOCK_USER, session-manager, and the dev short-circuit are all present.
2. Ships its own `middleware.ts` (overwrites the dev middleware).
3. Ships `src/lib/auth/get-current-user.ts` and `require-auth.ts` that honour `AUTH_MODE=mock` by returning `MOCK_USER` directly.
4. Imports `COOKIE_NAME` from `session-manager.ts` (single source of truth).

A single install can have at most one real provider — all six Group A providers + Supabase Auth declare mutual `conflicts`. The wizard's `findConflicts` is symmetric, so the conflict is enforced from either direction.
