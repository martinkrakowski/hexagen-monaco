# Templates: Real Auth Providers

**Branch:** `feature/shared-types-and-derived-answers`
**Status:** Implemented (v2.x). Updated after the shared-types extraction.

## Scope

Six "real" auth provider templates, each owning its own end-to-end auth stack. After the shared-types extraction (PR landing this design):

| Template          | Mechanism                                             | Requires                                             |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `google-oauth`    | OAuth 2.0 code flow, encrypted session                | `shared-types`, `auth-mock`, `env-setup`             |
| `github-oauth`    | OAuth App, primary-email + org gate                   | `shared-types`, `auth-mock`, `env-setup`             |
| `microsoft-entra` | PKCE confidential-client, group→role mapping          | `shared-types`, `auth-mock`, `env-setup`             |
| `magic-link`      | HMAC-signed single-use email tokens                   | `shared-types`, `auth-mock`, `env-setup`             |
| `adobe-ims-spa`   | IMS PKCE + encrypted tokens + auto-refresh            | `shared-types`, `auth-mock`, `env-setup`             |
| `supabase-auth`   | `@supabase/ssr` middleware (separate from `supabase`) | `supabase`, `shared-types`, `auth-mock`, `env-setup` |

The three Group B frameworks (`nextauth`, `clerk`, `better-auth`) bring their own auth model and conflict with every entry above plus `auth-mock`.

---

## Shared architecture

Each real provider:

- `requires: ["shared-types", "auth-mock", "env-setup"]`. `shared-types` is the new home for `UserContext`, `MOCK_USER`, and the session-cookie helpers (including `COOKIE_NAME`).
- `conflicts` with **every other real provider** (each one ships its own root `middleware.ts`; only one can win).
- Ships these files (paths relative to project root):

  ```text
  middleware.ts                          # Root middleware. AUTH_MODE=mock short-circuit, then provider validation.
  src/lib/auth/get-current-user.ts       # Server helper. Imports COOKIE_NAME from session-manager.
  src/lib/auth/require-auth.ts           # redirect-on-fail wrapper around get-current-user.
  app/api/auth/me/route.ts               # GET → UserContext or 401.
  app/api/auth/login/<provider>/route.ts # Initiates the flow.
  app/api/auth/callback/<provider>/...   # Completes the flow, sets session cookie.
  app/api/auth/logout/<provider>/...     # Clears the cookie.
  src/infrastructure/auth/<provider>/    # provider-specific client + session-store + mapper + (thin) adapter
  .env.<provider>.example
  ```

- Asks one shared install-time question in addition to provider-specific ones:
  - `protected_paths` (default `/dashboard,/api/protected`) — comma-separated path prefixes the middleware enforces.

  The session cookie name lives in `shared-types` (single source of truth). Provider helpers import `COOKIE_NAME` from `session-manager.ts` and pick up runtime overrides from `AUTH_COOKIE_NAME`.

### Middleware shape

```ts
export default async function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("x-user-context"); // never trust client-supplied value

  if (process.env.AUTH_MODE === "mock") {
    if (process.env.NODE_ENV !== "development") throw new Error("...");
    headers.set("x-user-context", JSON.stringify(MOCK_USER));
    return NextResponse.next({ request: { headers } });
  }
  if (!isProtected(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  const token = readSessionToken(request);
  if (!token) return redirectToLogin();
  const user = await decryptSession(token); // provider-specific
  if (!user) return redirectToLogin();

  headers.set(
    "x-user-context",
    JSON.stringify(mapProviderUserToUserContext(user)),
  );
  return NextResponse.next({ request: { headers } });
}
```

Adobe IMS deviates slightly (calls IMS to fetch the profile and may refresh tokens; refresh persists via `Set-Cookie`); Supabase Auth uses `@supabase/ssr`'s session-refresh pattern with cookie round-tripping. The contract is identical: AUTH_MODE=mock short-circuit, protect configured paths, attach UserContext as `x-user-context`.

### Adapter classes (trimmed)

Each provider's `<provider>-auth.adapter.ts` used to implement the dropped `AuthProviderPort`. Now it's a thin helper used only by the callback route. Validation logic moved to `middleware.ts` and `src/lib/auth/get-current-user.ts`. Adobe IMS keeps its `validate()` method on the adapter because IMS validation involves a profile-fetch + refresh round-trip.

---

## Manifest summary

```json
{
  "requires": ["shared-types", "auth-mock", "env-setup"],
  "conflicts": [
    "nextauth",
    "clerk",
    "better-auth",
    "<the other 5 real providers>"
  ],
  "questions": [
    /* provider-specific... */
    { "id": "protected_paths", "default": "/dashboard,/api/protected" }
  ],
  "outputs": [
    /* provider-specific files... */
    "src/lib/auth/get-current-user.ts",
    "src/lib/auth/require-auth.ts",
    "app/api/auth/login/<provider>/route.ts",
    "app/api/auth/callback/<provider>/route.ts",
    "app/api/auth/logout/<provider>/route.ts",
    "app/api/auth/me/route.ts",
    "middleware.ts",
    ".env.<provider>.example"
  ]
}
```

---

## What this replaces

Pre-restructure (v1) had a single `AuthProviderPort`, an auth-mock-shipped `server/middleware/auth.middleware.ts`, an `application/services/auth.service.ts`, and each provider shipping a `real-auth.adapter.stub.ts`. PR #108 replaced that with per-provider middleware. This iteration further moves the shared types out of `auth-mock` into `shared-types`, and splits Supabase into a storage-only template plus a separate `supabase-auth` auth provider — see [15-supabase-auth.md](./15-supabase-auth.md).
