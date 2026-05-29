# Template: Supabase

**Branch:** `feature/generator-template-supabase`

## Purpose

Generates a complete Supabase integration: typed client setup for both browser and server (SSR-safe), storage helpers with signed URL generation, auth helpers, RLS policy stubs, and type generation configuration. Gets persistence and file storage working in minutes.

---

## Install-Time Questions

| ID                 | Prompt                                       | Type        | Options                                                     | Default            |
| ------------------ | -------------------------------------------- | ----------- | ----------------------------------------------------------- | ------------------ |
| `project_url`      | Supabase project URL?                        | text        | —                                                           | _(required)_       |
| `anon_key`         | Supabase anon key?                           | text        | —                                                           | _(required)_       |
| `features`         | Which Supabase features?                     | multiselect | `database`, `storage`, `auth`, `realtime`, `edge-functions` | `database,storage` |
| `storage_buckets`  | Storage bucket names (comma-separated)?      | text        | —                                                           | `uploads`          |
| `orm`              | Use Drizzle ORM over Supabase?               | boolean     | —                                                           | `false`            |
| `type_gen`         | Set up automatic TypeScript type generation? | boolean     | —                                                           | `true`             |
| `rls_examples`     | Generate example RLS policies?               | boolean     | —                                                           | `true`             |
| `realtime_example` | Generate realtime subscription example?      | boolean     | —                                                           | `false`            |

---

## Files Generated

```
src/
  infrastructure/
    supabase/
      client.ts               # Browser client (singleton)
      server.ts               # Server client (per-request, cookie-based)
      admin.ts                # Service role client (server-only, never ship to browser)
      storage/
        upload.ts             # Upload file, return public/signed URL
        download.ts           # Download file as Buffer or stream
        signed-url.ts         # Generate time-limited signed URL
        delete.ts             # Delete a file
        index.ts
      auth/
        get-user.ts           # getUser() — always calls server, never trusts JWT locally
        require-auth.ts       # Middleware helper: redirect if no session
        index.ts
      realtime/               # (if realtime selected)
        subscribe.ts          # Channel subscription helper
      types/
        database.types.ts     # Placeholder — replaced by supabase gen types

supabase/
  migrations/
    .gitkeep                  # Migrations directory (run: supabase init)
  seed.sql                    # Example seed data

scripts/
  gen-types.sh                # supabase gen types typescript --local > src/...

.env.supabase.example
```

---

## Generated .env Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # NEVER expose to browser; server-only

# Storage
SUPABASE_STORAGE_BUCKET_UPLOADS=uploads
SUPABASE_SIGNED_URL_EXPIRY=3600  # 1 hour in seconds
```

---

## Key Design Decisions

**Two clients, two contexts:** `client.ts` (browser, anon key, public) and `server.ts` (server, reads auth cookies, per-request) are separate files with different constructors. Never use the browser client in server-side code — it skips cookie-based session propagation.

**`admin.ts` is explicitly named:** The service role client bypasses RLS. Naming it `admin.ts` (not `server.ts` or `supabase.ts`) makes it obvious in code review when a component is doing RLS-bypassing operations. It is never imported from any client-side barrel.

**`getUser()` always calls the server:** `supabase.auth.getUser()` makes a network request to validate the JWT server-side. `getSession()` trusts the local JWT without validation and is intentionally not generated. This follows Supabase's own security guidance.

**Storage helpers return `Result<T, StorageError>`:** Never throw; let the caller decide how to handle failures. Signed URLs expire — callers should re-request them rather than caching indefinitely.

**Drizzle is opt-in:** When `orm=true`, an additional `src/infrastructure/supabase/drizzle/` folder is generated with a Drizzle client, `schema.ts` stub, and `migrate.ts` script.

---

## Phase 1 — Client Setup

**Goal:** Working browser and server clients with correct package setup.

Install: `@supabase/supabase-js@^2`, `@supabase/ssr`

`client.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types/database.types.js";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
```

`server.ts`:

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cs) => cs.forEach((c) => cookieStore.set(c)),
    },
  });
}
```

Validation: TypeScript compiles; `createSupabaseServerClient()` returns typed client.

---

## Phase 2 — Storage Helpers

**Goal:** Simple, typed helpers for the most common storage operations.

`upload.ts`:

```typescript
export async function uploadFile(
  bucket: string,
  path: string,
  file: File | Buffer,
  options?: { contentType?: string; upsert?: boolean },
): Promise<Result<{ path: string; url: string }, StorageError>>;
```

`signed-url.ts`:

```typescript
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn?: number, // seconds, default: SUPABASE_SIGNED_URL_EXPIRY
): Promise<Result<string, StorageError>>;
```

`delete.ts`:

```typescript
export async function deleteFile(
  bucket: string,
  paths: string[],
): Promise<Result<void, StorageError>>;
```

Validation: Integration test against real Supabase project (skipped without env vars); unit test for error wrapping.

---

## Phase 3 — Auth Helpers

**Goal:** Safe, reusable server-side auth helpers.

`get-user.ts`:

```typescript
export async function getCurrentUser(): Promise<UserContext | null>;
// Uses supabase.auth.getUser() — validates JWT server-side
// Returns null (never throws) if not authenticated
```

`require-auth.ts`:

```typescript
export async function requireAuth(): Promise<UserContext>;
// Calls getCurrentUser(); throws AuthenticationError if null
// For use in Server Actions and API routes
```

If `auth-mock` is installed: `AdobeIMSAuthAdapter` (or generic `SupabaseAuthAdapter`) is registered as the real auth provider, and `AUTH_MODE=real` activates it.

Validation: Unit test for `getCurrentUser()` returning null when no session cookie.

---

## Phase 4 — Type Generation

**Goal:** Keep TypeScript types in sync with Supabase schema automatically.

`scripts/gen-types.sh`:

```bash
#!/bin/bash
supabase gen types typescript --local \
  > src/infrastructure/supabase/types/database.types.ts
echo "✅ Types generated"
```

`package.json` script addition:

```json
"gen:types": "bash scripts/gen-types.sh"
```

`database.types.ts` placeholder:

```typescript
// Run `yarn gen:types` after any schema change to update this file.
export type Database = { public: { Tables: {}; Views: {}; Functions: {} } };
```

Validation: `yarn gen:types` runs without error (requires `supabase` CLI and a running local instance).

---

## Phase 5 — RLS Policy Examples

**Goal:** Show the pattern for common RLS policies without requiring a specific schema.

`supabase/migrations/0001_example_rls.sql`:

```sql
-- Example: Users can only read their own rows
-- ALTER TABLE items ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "users can read own items"
--   ON items FOR SELECT
--   USING (auth.uid() = user_id);

-- Example: Authenticated users can insert
-- CREATE POLICY "authenticated users can insert"
--   ON items FOR INSERT
--   WITH CHECK (auth.uid() IS NOT NULL);
```

Validation: SQL is syntactically valid (commented-out DDL).

---

## Phase 6 — Drizzle Integration (opt-in)

**Goal:** Drizzle ORM layer over the Supabase Postgres connection.

Install: `drizzle-orm`, `drizzle-kit`, `postgres`

Files:

- `src/infrastructure/supabase/drizzle/client.ts` — Drizzle client over `SUPABASE_DB_URL`
- `src/infrastructure/supabase/drizzle/schema.ts` — Schema stubs with example table
- `scripts/migrate.ts` — `drizzle-kit migrate` wrapper
- `drizzle.config.ts`

```env
# Add to .env.local when using Drizzle
SUPABASE_DB_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres
```

Validation: `yarn migrate` runs without error against local Supabase.

---

## Phase 7 — Realtime Subscription Example (opt-in)

**Goal:** Working example of a Supabase realtime channel subscription.

`src/infrastructure/supabase/realtime/subscribe.ts`:

```typescript
export function subscribeToTable<T>(
  table: string,
  filter: string,
  onInsert: (record: T) => void,
): RealtimeChannel;
```

Includes teardown (`.unsubscribe()`) pattern and a React hook example: `useRealtimeTable(table, filter)`.

Validation: Unit test with mocked Supabase realtime client.

---

## Post-Install Checklist

```
✅ supabase installed

Next steps:
  1. Merge .env.supabase.example into .env.local
  2. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from your project settings
  3. Set SUPABASE_SERVICE_ROLE_KEY — keep this server-only, never expose to the browser
  4. Create storage buckets in Supabase dashboard or via: supabase storage create <name>
  5. Run: yarn gen:types  (after supabase init + any schema changes)
  6. Enable RLS on all tables before going to production
  7. See SETUP.md → Supabase for local dev setup with supabase CLI
```

---

## Template Dependencies

- Required: `env-setup`
- Integrates with: `auth-mock` (fills SupabaseAuthAdapter into real provider slot)
- Integrates with: `adobe-ims-spa` (SupabaseTokenStore for IMS tokens)
- Soft dependency: `observability` (structured logging for storage errors)
