# Template: Supabase

**Branch:** `feature/auth-stack-restructure`
**Status:** Implemented (v2.0). Restructured to match the unified auth ecosystem.

## Purpose

SSR-safe Supabase client + storage + RLS + (optional) Drizzle + (optional) realtime. When `features` includes `"auth"`, also acts as a **full auth provider**: ships a `@supabase/ssr` root middleware, `src/lib/auth/getCurrentUser`/`requireAuth`, and `/api/auth/me` — all honouring `AUTH_MODE=mock` as a dev short-circuit.

What changed from v1:

- Dropped the `use_auth_mock` question.
- Dropped `SupabaseAuthAdapter` (implemented the removed `AuthProviderPort`).
- Dropped the gated `real-auth.adapter.stub.ts` (no longer any abstract slot to fill).
- Dropped the old `src/infrastructure/supabase/auth/` folder (returned raw Supabase `User`, threw `AuthenticationError`).
- Added: `middleware.ts`, `src/lib/auth/get-current-user.ts`, `src/lib/auth/require-auth.ts`, `app/api/auth/me/route.ts` — all gated on `features` including `"auth"`.
- Added: `protected_paths` question (used only when auth is in features).
- Added: `requires: ["env-setup", "auth-mock"]` (for `UserContext` + `MOCK_USER`) — small overhead if auth is not selected, but keeps the install model consistent.
- Added mutual `conflicts` with all five Group A providers and the three Group B frameworks.

---

## Install-Time Questions

| ID                 | Type        | Default                     | Notes                                                       |
| ------------------ | ----------- | --------------------------- | ----------------------------------------------------------- |
| `project_url`      | text        | _required_                  | Supabase project URL                                        |
| `anon_key`         | text        | _required_                  | Public anon key                                             |
| `features`         | multiselect | `["database","storage"]`    | `database`, `storage`, `auth`, `realtime`, `edge-functions` |
| `storage_buckets`  | text        | `uploads`                   | Comma-separated bucket names                                |
| `orm`              | boolean     | `false`                     | Drizzle ORM layer                                           |
| `type_gen`         | boolean     | `true`                      | `supabase gen types` script                                 |
| `rls_examples`     | boolean     | `true`                      | Example RLS migration                                       |
| `realtime_example` | boolean     | `false`                     | Subscription example                                        |
| `protected_paths`  | text        | `/dashboard,/api/protected` | Used only when `auth` is in features                        |

---

## Files Generated (selected)

```text
src/infrastructure/supabase/
  client.ts                  # createBrowserClient
  server.ts                  # createSupabaseServerClient (cookies-aware)
  admin.ts                   # service-role client, server-only
  result.ts                  # Result + AuthenticationError + StorageError
  types/database.types.ts
  storage/...                # when features ⊇ {storage}
  drizzle/...                # when orm = true
  realtime/subscribe.ts      # when realtime_example = true

# when features ⊇ {auth}:
middleware.ts                # @supabase/ssr session-refresh + AUTH_MODE=mock short-circuit
src/lib/auth/get-current-user.ts
src/lib/auth/require-auth.ts
app/api/auth/me/route.ts

.env.supabase.example
supabase/seed.sql
supabase/migrations/0001_example_rls.sql   # when rls_examples
scripts/gen-types.sh                       # when type_gen
scripts/migrate.ts                         # when orm
drizzle.config.ts                          # when orm
```

---

## Middleware

Uses Supabase's recommended SSR pattern. The session refresh **must** happen between `createServerClient` and `getUser` with cookies being round-tripped through the response — otherwise the client never sees the refreshed JWT.

```ts
if (process.env.AUTH_MODE === "mock") {
  // attach JSON.stringify(MOCK_USER) as x-user-context, pass through
  return ...;
}

let response = NextResponse.next({ request: { headers: request.headers } });
const supabase = createServerClient(url, key, {
  cookies: { getAll, setAll: (toSet) => { /* round-trip through request + response */ } },
});

// nothing between these two:
const { data: { user } } = await supabase.auth.getUser();

if (isProtected(pathname) && !user) return NextResponse.redirect("/login");
if (user) response.headers.set("x-user-context", JSON.stringify(mapSupabaseUserToUserContext(user)));
return response;
```

---

## getCurrentUser

```ts
if (process.env.AUTH_MODE === "mock") return MOCK_USER;
const supabase = await createSupabaseServerClient();
const { data, error } = await supabase.auth.getUser(); // server-validated JWT
// map data.user → UserContext (id, email, name, roles=["user"], avatarUrl)
```

`getUser()` validates the JWT server-side on every call. `getSession()` is intentionally not exposed — never authorize off a locally-decoded token.

---

## Why supabase always requires auth-mock

Manifests don't support conditional `requires`. Auth-mock is lightweight (5 files, ~120 LOC) and ships the `UserContext` type + `MOCK_USER` + session-cookie helpers that supabase relies on when `auth` is in features. Forcing it everywhere costs ~120 LOC of unused files in storage-only installs; making it conditional would require schema work that isn't worth the savings.

---

## Conflicts (gated)

Supabase's conflicts with the eight other auth-providing templates are **gated on `features ⊇ {auth}`** — they only fire when this install actually emits the auth middleware. Storage-only or database-only Supabase coexists fine with any auth provider.

```json
"conflicts": [
  { "id": "nextauth",        "when": { "answer": "features", "includes": "auth" } },
  { "id": "clerk",           "when": { "answer": "features", "includes": "auth" } },
  { "id": "better-auth",     "when": { "answer": "features", "includes": "auth" } },
  { "id": "google-oauth",    "when": { "answer": "features", "includes": "auth" } },
  { "id": "github-oauth",    "when": { "answer": "features", "includes": "auth" } },
  { "id": "microsoft-entra", "when": { "answer": "features", "includes": "auth" } },
  { "id": "magic-link",      "when": { "answer": "features", "includes": "auth" } },
  { "id": "adobe-ims-spa",   "when": { "answer": "features", "includes": "auth" } }
]
```

The Group A providers no longer list `supabase` in their conflict arrays — the asymmetric conflict is declared only on the Supabase side because only Supabase knows whether its install is bringing auth.

### Engine semantics

`resolveDependencies` evaluates gated conflicts using the same `{ answer, equals?, includes? }` shape as gated outputs (PR #101). Plain-string conflicts always fire; object-form conflicts fire only when the declaring template's answers satisfy the gate.

### Wizard semantics

The wizard's `findConflicts` skips gated entries because user answers don't exist at add-on selection time. Surfacing them there would either require asking gating questions up-front (bad UX) or produce false positives by assuming every gate fires. The engine catches them at install time when answers are known and throws `ConflictError` with a clear message.
