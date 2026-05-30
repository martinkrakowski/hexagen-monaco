# Template: Supabase Auth

**Branch:** `feature/shared-types-and-derived-answers`
**Status:** Implemented (v1.0). New template introduced by the supabase split.

## Purpose

Authentication provider built on the [Supabase](./05-supabase.md) template: a `@supabase/ssr` root middleware that refreshes the session every request and protects configured paths, `/api/auth/me`, and `getCurrentUser()` / `requireAuth()` helpers in `src/lib/auth/` — all honouring `AUTH_MODE=mock` as a dev short-circuit.

This template was carved out of `supabase` v2 to eliminate the phantom-files problem: storage-only Supabase installs had to drag the auth-mock stack along even when not emitting any auth code. With the split, storage and auth are two cleanly composable templates with a static dependency graph.

---

## Install-Time Questions

| ID                | Type | Default                     | Notes                                          |
| ----------------- | ---- | --------------------------- | ---------------------------------------------- |
| `protected_paths` | text | `/dashboard,/api/protected` | Path prefixes the middleware requires auth for |

---

## Files Generated

```text
middleware.ts                          # Root middleware — @supabase/ssr session refresh + protected-path enforcement
src/lib/auth/get-current-user.ts       # Server helper; short-circuits via x-user-context header
src/lib/auth/require-auth.ts           # redirect-on-fail wrapper
app/api/auth/me/route.ts               # GET → UserContext or 401
```

No env vars of its own — the Supabase URL/key come from the `supabase` template; `AUTH_MODE` / `AUTH_COOKIE_NAME` / `MOCK_USER_*` come from `shared-types` and `auth-mock`.

---

## Dependencies

- `requires: ["supabase", "shared-types", "auth-mock", "env-setup"]`. **Static, unconditional.** No gated requires; the dependency resolver runs before answers are collected and the static graph keeps that path correct.
- `conflicts:` unconditional plain-string list against all eight other auth-related templates (5 Group A + 3 Group B). Mutually exclusive with any other auth provider.

---

## Middleware behaviour

Uses Supabase's recommended SSR pattern. The session refresh **must** happen between `createServerClient` and `getUser` with cookies round-tripping through both `request` and `response`.

```ts
request.headers.delete("x-user-context"); // never trust client-supplied value

if (process.env.AUTH_MODE === "mock") {
  if (process.env.NODE_ENV !== "development") throw new Error("...");
  request.headers.set("x-user-context", JSON.stringify(MOCK_USER));
  return NextResponse.next({ request });
}

let response = NextResponse.next({ request });
const supabase = createServerClient(url, key, { cookies: { getAll, setAll } });

// nothing between createServerClient and getUser:
const {
  data: { user },
} = await supabase.auth.getUser();

if (isProtected(pathname) && !user) return NextResponse.redirect("/login");
if (user)
  request.headers.set(
    "x-user-context",
    JSON.stringify(mapSupabaseUserToUserContext(user)),
  );
return response;
```

---

## getCurrentUser

```ts
if (process.env.AUTH_MODE === "mock") return MOCK_USER; // dev short-circuit
const cached = (await headers()).get("x-user-context");
if (cached) return JSON.parse(cached) as UserContext; // trust middleware
const supabase = await createSupabaseServerClient();
const { data, error } = await supabase.auth.getUser(); // server-validated JWT
// map data.user → UserContext (id, email, name, roles=["user"], avatarUrl)
```

`getUser()` validates the JWT server-side on every call. `getSession()` is intentionally not exposed.

---

## What about sign-in / sign-up?

Out of scope for this template. The Supabase template ships the typed client (`createBrowserClient`, `createSupabaseServerClient`). Wiring `supabase.auth.signInWithPassword` or `signInWithOAuth` to your UI is app-specific — that's the whole point of separating the _session validation plumbing_ (this template) from the _credential entry UX_ (consumer code).

---

## Conflicts

Unconditional plain-string conflicts with:

- `nextauth`, `clerk`, `better-auth` (Group B frameworks; replace auth wholesale)
- `google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`, `adobe-ims-spa` (Group A providers; all ship their own root middleware)

---

## Tests

- `__tests__/templates/supabase-emit-shape.test.ts` — `supabase-auth template — full-stack emit` asserts that installing `supabase-auth` auto-resolves `supabase`, `shared-types`, `auth-mock`, and `env-setup`; emits its own four files plus `shared-types`' three foundation files.

---

## Migration from Supabase v2's auth feature

Prior to this split, users picked `supabase` and added `"auth"` to its `features` multiselect. Equivalent install today:

- v2: `hexagen add supabase` → answer `features = ["database","storage","auth"]`.
- v3: `hexagen add supabase-auth` → auto-resolves `supabase` (answer storage features as before).

The wizard catalog reflects the change: the Supabase tile no longer advertises an auth feature; the Supabase Auth tile in the `auth` category is the entry point.
