# Supabase (`supabase`)

> SSR-safe browser/server/admin clients, Result-based storage helpers, RLS examples, type
> generation, and optional Drizzle ORM + realtime. A pure storage/database layer — no auth code.

|               |                                            |
| ------------- | ------------------------------------------ |
| **ID**        | `supabase`                                 |
| **Category**  | Persistence / database                     |
| **Requires**  | `env-setup`                                |
| **Conflicts** | none                                       |
| **Branch**    | `feature/shared-types-and-derived-answers` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

The Supabase data layer: correctly-scoped clients (browser anon, server SSR, admin service-role),
Result-returning storage helpers, optional Drizzle ORM, type generation, and example RLS. Carries
**no auth** — add [`supabase-auth`](../supabase-auth) for session middleware on top.

## What it scaffolds

- `src/infrastructure/supabase/{client,server,admin,result}.ts` + generated `types/database.types.ts`.
- Optional `storage/*` helpers (upload/download/signed-url/delete), `drizzle/*`, `realtime/subscribe.ts`.
- `supabase/seed.sql` (always); optional `migrations/0001_example_rls.sql` (`rls_examples`) and `scripts/gen-types.sh` (`type_gen`).

## Install

`hexagen add supabase`. Questions: `project_url`, `anon_key` (both required), `features`
(`storage`), `storage_buckets`, `orm` (bool), `type_gen` (bool), `rls_examples` (bool),
`realtime_example` (bool).

Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## Usage

```ts
import { createBrowserClient } from "@/infrastructure/supabase/client";
import { createServerClient } from "@/infrastructure/supabase/server";
import { adminClient } from "@/infrastructure/supabase/admin"; // service role — server only
```

## Notes for agents

- **`SUPABASE_SERVICE_ROLE_KEY` is server-only** — never `NEXT_PUBLIC_` it (it bypasses RLS).
- Enable RLS on every table before production (see the example migration).
- Drizzle is opt-in (`npm install drizzle-orm postgres`, set `SUPABASE_DB_URL`).
- For auth, install [`supabase-auth`](../supabase-auth).

## Checklist (post-install)

`npm install @supabase/supabase-js @supabase/ssr`; set URL/anon/service-role; create buckets;
enable RLS; optionally wire type-gen + Drizzle.

## Related

Requires [`env-setup`](../env-setup). Auth layer: [`supabase-auth`](../supabase-auth). Background
jobs: [`bullmq`](../bullmq).
