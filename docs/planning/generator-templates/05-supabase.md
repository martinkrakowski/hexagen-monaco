# Template: Supabase

**Branch:** `feature/shared-types-and-derived-answers`
**Status:** Implemented (v3.0). Auth split out to a sibling template.

## Purpose

SSR-safe Supabase client setup, storage helpers, RLS examples, type generation, optional Drizzle ORM and optional realtime subscription example. **No auth code** — that's now `supabase-auth`, a separate template that requires this one.

Storage-only / database-only Supabase installs ship **zero** auth files. Coexists with any auth provider (no conflicts).

What changed in v3 compared to v2:

- Dropped `"auth"` from the `features` multiselect options.
- Dropped `requires: ["auth-mock"]` — Supabase no longer needs it.
- Dropped all eight conflict entries (the gated ones from PR #108 + the unconditional ones).
- Dropped the four auth-gated outputs (middleware.ts, src/lib/auth/get-current-user.ts, src/lib/auth/require-auth.ts, app/api/auth/me/route.ts). They moved to `supabase-auth`.
- Dropped the `protected_paths` question (moved to `supabase-auth`).

---

## Install-Time Questions

| ID                 | Type        | Default                  | Notes                                               |
| ------------------ | ----------- | ------------------------ | --------------------------------------------------- |
| `project_url`      | text        | _required_               | Supabase project URL                                |
| `anon_key`         | text        | _required_               | Public anon key                                     |
| `features`         | multiselect | `["database","storage"]` | `database`, `storage`, `realtime`, `edge-functions` |
| `storage_buckets`  | text        | `uploads`                | Comma-separated bucket names                        |
| `orm`              | boolean     | `false`                  | Drizzle ORM layer                                   |
| `type_gen`         | boolean     | `true`                   | `supabase gen types` script                         |
| `rls_examples`     | boolean     | `true`                   | Example RLS migration                               |
| `realtime_example` | boolean     | `false`                  | Subscription example                                |

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

.env.supabase.example
supabase/seed.sql
supabase/migrations/0001_example_rls.sql   # when rls_examples
scripts/gen-types.sh                       # when type_gen
scripts/migrate.ts                         # when orm
drizzle.config.ts                          # when orm
```

Notably absent: no `middleware.ts`, no `src/lib/auth/*`, no `/api/auth/me`, no auth env vars. Storage-only Supabase is auth-agnostic by construction.

---

## Adding Supabase-backed auth

Install the **`supabase-auth`** template. It declares `requires: ["supabase", "shared-types", "auth-mock", "env-setup"]`, so picking it auto-resolves the storage core + the auth stack. See [15-supabase-auth.md](./15-supabase-auth.md).

A regression test (`__tests__/templates/supabase-emit-shape.test.ts`) asserts at CI time that installing `supabase` alone emits zero auth files; the test runs against the real template directories so any future drift fails fast.

---

## Conflicts

None. Storage/database Supabase is compatible with any auth provider. `supabase-auth` carries the auth-provider conflict list — eight unconditional plain-string conflicts total: the five other Group A providers (`google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`, `adobe-ims-spa`) plus the three Group B frameworks (`nextauth`, `clerk`, `better-auth`).
