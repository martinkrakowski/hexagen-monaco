# Templates: Real Auth Providers

**Branch:** `feature/auth-stack-restructure`
**Status:** Implemented (v2.0). Group A / Group B framing dropped.

## Scope

Six "real" auth provider templates, each owning its own end-to-end auth stack:

| Template          | Mechanism                                               | Conflicts with           |
| ----------------- | ------------------------------------------------------- | ------------------------ |
| `google-oauth`    | OAuth 2.0 authorization-code, encrypted session         | all other auth providers |
| `github-oauth`    | OAuth App, primary-email + org gate                     | all other auth providers |
| `microsoft-entra` | PKCE confidential-client, group→role mapping            | all other auth providers |
| `magic-link`      | HMAC-signed single-use email tokens                     | all other auth providers |
| `adobe-ims-spa`   | IMS PKCE + encrypted tokens + auto-refresh              | all other auth providers |
| `supabase`        | `@supabase/ssr` middleware (when `auth` is in features) | all other auth providers |

The three Group B frameworks (`nextauth`, `clerk`, `better-auth`) still exist as standalone-framework templates that bring their own auth model and conflict with everything above and `auth-mock`.

---

## Shared Architecture (post-restructure)

Each real provider:

- `requires: ["auth-mock", "env-setup"]` — so `UserContext`, `MOCK_USER`, and session-cookie helpers are present.
- `conflicts` with **every other real provider** (each one ships its own root `middleware.ts`; only one can win).
- Ships these files (paths relative to project root):

  ```text
  middleware.ts                          # Root middleware. AUTH_MODE=mock short-circuit, then provider validation.
  src/lib/auth/get-current-user.ts       # Server helper. Honours AUTH_MODE=mock.
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

  The session cookie name lives only in auth-mock (single source of truth). Provider helpers hardcode `"__auth_session"` as the fallback and pick up runtime overrides from `AUTH_COOKIE_NAME`.

### Middleware shape

```ts
export default async function middleware(request: NextRequest) {
  if (process.env.AUTH_MODE === "mock") {
    // attach JSON.stringify(MOCK_USER) as x-user-context, pass through
    return ...;
  }
  if (!isProtected(request.nextUrl.pathname)) return NextResponse.next();

  const token = readSessionToken(request);
  if (!token) return redirectToLogin();

  const user = await decryptSession(token);          // provider-specific
  if (!user) return redirectToLogin();

  const ctx = mapProviderUserToUserContext(user);    // provider-specific
  // attach JSON.stringify(ctx) as x-user-context
  return ...;
}
```

Adobe IMS and Supabase deviate slightly (IMS calls IMS to fetch profile and may refresh tokens; Supabase uses `@supabase/ssr`'s session-refresh pattern with cookie round-tripping). The contract — `AUTH_MODE=mock` short-circuit, protect configured paths, attach UserContext as `x-user-context` — is identical.

### Adapter classes (trimmed)

Each provider's `<provider>-auth.adapter.ts` used to implement the dropped `AuthProviderPort`. Now it's a thin helper used only by the callback route:

```ts
export class GoogleAuthAdapter {
  async createSessionFromGoogleUser(user: GoogleUser): Promise<string> {
    // hosted-domain check, then encryptSession
  }
}
```

Validation logic moved to `middleware.ts` and `src/lib/auth/get-current-user.ts`. Adobe IMS keeps its `validate()` method on the adapter because IMS validation involves a profile-fetch + refresh round-trip — `middleware.ts` and `get-current-user.ts` both reuse it.

---

## Manifest summary

```json
{
  "requires": ["auth-mock", "env-setup"],
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

The Supabase manifest gates the auth files on `features` including `"auth"` so the same template can be installed for storage/database-only use without bringing auth machinery.

---

## What this replaces

Pre-restructure (v1) had a single `AuthProviderPort`, an auth-mock-shipped `server/middleware/auth.middleware.ts`, an `application/services/auth.service.ts`, and each provider shipping a `real-auth.adapter.stub.ts` that re-exported the provider's adapter as `RealAuthAdapter`. That stub-override pattern was silently broken until PR #106 (cross-template `wasGeneratedByHexagen` scan), and the port abstraction couldn't model providers that needed request-scoped state (e.g. Supabase cookies, IMS auto-refresh). The restructure deletes the abstraction and lets every provider own its full stack.
