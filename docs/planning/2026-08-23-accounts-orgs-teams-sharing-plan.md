# Accounts, organizations, teams, and project sharing — implementation plan

**Date:** 2026-08-23
**Predecessor:** the 2026-08-20 hosting plan (`docs/planning/2026-08-20-hosting-migration-plan.md`, committed alongside this document in #634; its Wave H1 items are referenced below by ID and are not re-planned here)
**Siblings:** `2026-08-23-client-storage-to-server-plan.md` (Plan 1), `2026-08-23-gcp-migration-plan.md` (Plan 3 — owns the Postgres decision, D-H4)
**Baseline:** `main` @ `d582213a`; prod = single container, `platform.db` on the `hexagen-monaco-quota-data` volume (ADR-0065)

## What this adds, and what it does not re-plan

The 2026-08-20 hosting plan already designs **organizations**: an org is "just another owner" — the org UUID becomes `owner_id`, which every prepared statement in `lib/platform/*` already bakes in (PK `(owner_id, id)`, verified in `platform-db.ts:248-258`). That plan's H1.1 (schema), H1.2 (`requireTenant`), H1.3 (owner/member roles), H1.4 (`rev` + `If-Match` + `updated_by`), H1.5 (org run history), H1.6 (BYOK stays personal), H1.7 (IDB lift personal-tenant-only) stand as written. This document does not restate them.

Two things in the new ask are **not** covered by H1 and cannot be had for free from the owner trick:

1. **Teams inside organizations.**
2. **Projects shared across organizations and/or teams.**

Stated up front so it can be checked rather than rationalised: **the org-as-owner trick gives a project exactly one owner. Sharing is the first feature that needs a second predicate on every read path, and that is where the trick stops being free.** The plan below keeps the trick for ownership and adds grants beside it, rather than replacing ownership with an ACL model — because every existing store, route and test is built on `WHERE owner_id = ?`, and the blast radius of changing that is the whole platform seam.

### Verified corrections to the predecessor

- H1.1 keys invites "by GitHub login". The `users` table (`platform-db.ts:19-27`) has **no login column** — `id, name, email, email_verified, image, created_at` — and `accounts.provider_account_id` (`auth-store.ts:92-94`) holds GitHub's **numeric** ID, which nobody can type into an invite box. Inviting by login requires capturing `profile.login` at sign-in into a new `users.github_login` column (P-A1). Folded in below rather than assumed.
- H0.4's keyed single-row GET is still open: `app/api/projects/[projectId]/route.ts:60-72` does `loadProjects()` then `.find()`. Sharing makes this worse (a grantee's list is a union), so P-A3 lands H0.4 as a prerequisite, not a nicety.

## Data model

```
                 ownership (exists today)                      grants (new)
   ┌──────────────────────────────────────────┐    ┌─────────────────────────────────────┐
   │ saved_projects  PK (owner_id, id)        │    │ project_shares                      │
   │   owner_id = user UUID  (personal)       │◄───┤   owner_id, project_id  (FK → left) │
   │   owner_id = org  UUID  (H1)             │    │   grantee_type  user | org | team   │
   │   rev, updated_by        (H1.4)          │    │   grantee_id                        │
   └──────────────────────────────────────────┘    │   role          read | write        │
                                                   │   granted_by, created_at            │
   orgs (H1.1)        org_members (H1.1)           │   revoked_at    NULL = live         │
   teams              team_members                 │   PK (owner_id, project_id,         │
     id, org_id,        team_id, user_id             │       grantee_type, grantee_id)     │
     slug, name         PK (team_id, user_id)      └─────────────────────────────────────┘
     PK (id)            (user must be org_member)
     UNIQUE (org_id, slug)
```

**A project has exactly one owner** (a user or an org). **A team never owns anything.** Teams are membership groupings used only as grantees. This is decision D-A1; reasoning in the decisions table.

### Tables (SQLite DDL; migration in the `migrateSavedProjects` in-file style, `platform-db.ts:260-290`)

| table            | columns                                                                                                                                           | notes                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`          | `+ github_login TEXT` (nullable; UNIQUE where not null)                                                                                           | Captured from the OAuth profile at sign-in via the NextAuth adapter (`auth-store.ts:73`). Required for invites and share-by-handle.                             |
| `teams`          | `id, org_id, slug, name, created_by, created_at`; `UNIQUE (org_id, slug)`                                                                         | `org_id` FK to H1.1 `orgs`. Slug is the share handle: `@org-slug/team-slug`.                                                                                    |
| `team_members`   | `team_id, user_id`; `PK (team_id, user_id)`                                                                                                       | Insert refused unless `(org_id, user_id)` exists in `org_members`. Removal from the org cascades (P-A2 migration + app-level delete, not FK).                   |
| `project_shares` | `owner_id, project_id, grantee_type, grantee_id, role, granted_by, created_at, revoked_at`; `PK (owner_id, project_id, grantee_type, grantee_id)` | Soft-revoke (`revoked_at`) so the audit trail survives; all reads filter `revoked_at IS NULL`. Indexes: `(grantee_type, grantee_id)`, `(owner_id, project_id)`. |
| `audit_log`      | `id, actor_id, action, subject_owner_id, subject_id, grantee_type, grantee_id, created_at`                                                        | v1 scope = share/revoke/team-membership only (D-A6). Append-only; no update statement exists.                                                                   |

No Postgres-only SQL. `revoked_at IS NULL` partial indexes are SQLite-native and Postgres-compatible.

## Authorization: from one predicate to two

Today every project statement is `WHERE owner_id = ?` with `owner_id` closed over at store construction (`saved-projects-store.ts:68-71`). With shares, a request from tenant `T` for project `(O, P)` is allowed when:

```
T == O                                                           -- owner (today)
OR EXISTS (SELECT 1 FROM project_shares s
           WHERE s.owner_id = O AND s.project_id = P AND s.revoked_at IS NULL
             AND (  (s.grantee_type='user' AND s.grantee_id = :user)
                 OR (s.grantee_type='org'  AND s.grantee_id IN (:orgs_of_user))
                 OR (s.grantee_type='team' AND s.grantee_id IN (:teams_of_user)) ))
```

Design rule that keeps the seam intact: **the grant check is resolved once per request into a `ProjectAccess` value, and the existing owner-scoped store is then constructed for the project's real owner `O`.** The store's statements do not change. What changes is who is allowed to ask for `projectsFor(O)`.

```
requireTenant(req, tenantId)                    (H1.2 — unchanged)
resolveProjectAccess(req, ownerId, projectId)   (new, P-A3)
   → { role: 'owner' | 'write' | 'read', ownerId, actorUserId }
   → 403 when none
route → getPlatformStore().projectsFor(access.ownerId)   (existing store, real owner)
```

### Exactly what changes, with file:line

| surface                                                             | today                                             | change                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `saved-projects-store.ts:72-74` `selectAll`                         | `WHERE owner_id = ?`                              | **unchanged** — lists the tenant's own projects. Shared-with-me is a separate statement (below), never a union into this one.                                                                                |
| `saved-projects-store.ts:75-77` `selectOne`                         | `WHERE owner_id = ? AND id = ?`                   | **unchanged**; exposed publicly as `getProject(id)` (H0.4).                                                                                                                                                  |
| `saved-projects-store.ts:85-94` `update` / `updateIfMatch`          | no actor                                          | `SET ... updated_by = @actor, rev = rev + 1` and `WHERE ... rev = @expected_rev` (H1.4). `@actor` is the **grantee's** user id when writing via a grant.                                                     |
| `saved-projects-store.ts:98-114` `clear` + `replaceAll`             | bulk replace for the owner                        | **never reachable via a grant**. `PUT /api/projects` (bulk) requires `role === 'owner'`. A write grant is per-project; it must not be able to wipe the tenant.                                               |
| `saved-projects-store.ts:95-97` `remove`                            | owner delete                                      | requires `role === 'owner'`. Grantees cannot delete; they can leave (revoke their own grant).                                                                                                                |
| new statement `selectSharedWith(user, orgs[], teams[])`             | —                                                 | joins `project_shares` → `saved_projects` for live grants; returns `(owner_id, project, role)`. Lives in a new `project-shares-store.ts`, not in the owner store.                                            |
| `app/api/projects/route.ts:14-35` `GET`                             | owner list                                        | unchanged. New `GET /api/projects/shared` returns the shared-with-me list (P-A4).                                                                                                                            |
| `app/api/projects/route.ts:79-125` `PUT` (bulk)                     | `requirePersistenceOwner` → `saveProjects`        | `requireTenant`; owner role only. No grant path.                                                                                                                                                             |
| `app/api/projects/[projectId]/route.ts:48-84` `GET`                 | `loadProjects().find()` (`:60-72`)                | `resolveProjectAccess` → `getProject`. The project's owner comes from the route: `/api/tenants/[ownerId]/projects/[id]`, so a grantee addresses the real owner.                                              |
| `app/api/projects/[projectId]/route.ts:86-166` `PUT`                | `If-Match: updatedAt` → `putProject` (`:127-128`) | `If-Match: rev`; `role in (owner, write)`; `updated_by = actor`. 409 surfaces reload-and-merge (H1.4); the client's silent 3× retry (`http-saved-projects.adapter.ts:222`) is disabled for non-owner writes. |
| `app/api/projects/[projectId]/route.ts:168-195` `DELETE`            | owner delete                                      | owner only; `markProjectsInitialized` (`:195`) untouched.                                                                                                                                                    |
| `app/api/runs/route.ts:33-70`                                       | `runsFor(owner.ownerId)`                          | runs for a shared project are posted to the **project owner's** tenant with `actor_id` — see D-A3. Readable by anyone with a live grant on that project.                                                     |
| `http-saved-projects.adapter.ts:186-253` `HttpSavedProjectsAdapter` | fixed `/api/projects`                             | gains a base path per tenant (H1.2) and a second, read-mostly adapter for `/api/projects/shared`; shared projects are **not** written into the IDB cache (P-A5).                                             |
| `wire.client.ts:136-144`                                            | one `CachedSavedProjectsAdapter`                  | one per active tenant + one `SharedProjectsAdapter` (no cache).                                                                                                                                              |

Routes under `app/api/projects/scan/**`, `bootstrap`, `install-gate` do not read `saved_projects` and are untouched.

**ADR-0030 constraint, restated:** `byok-store.ts` is never org- or team-scoped and no share grants key access. A grantee editing a shared project uses their own key. **ADR-0063 constraint:** none of the eight frozen metering files is touched; signed-in metering identity remains H2.3 / D-H3.

## Packets

Sizes: S ≤ half a day, M ≤ two days, L more. Every exit criterion names a test that must fail before the packet and pass after — an authorization predicate is precisely the kind of check that passes vacuously when the fixture has no cross-tenant row.

**P-A1 — GitHub login on `users`** · S · after H1.1

- _What:_ `users.github_login` column + adapter capture at sign-in (`auth-store.ts:73`, NextAuth `profile` callback in `app/lib/auth.ts`). Backfill for existing users on next sign-in only (no API call to GitHub from a migration).
- _Exit:_ new sign-in populates the column; existing user without login can still sign in. **Failing-first:** invite-by-login test fails with "unknown handle" before, resolves after.

**P-A2 — Teams schema + membership** · M · after H1.1, P-A1

- _What:_ `teams`, `team_members`, `audit_log`; `POST/DELETE /api/orgs/[orgId]/teams`, `.../teams/[teamId]/members`. Org `owner` role manages teams; `member` can be in them. Removing a user from the org deletes their team rows in the same transaction.
- _Exit:_ **Failing-first:** add user to team without org membership → 409 (test `team-members.guard`); remove from org → `SELECT COUNT(*) FROM team_members WHERE user_id = ?` is 0 (test asserts it was > 0 before the removal — non-vacuous).

**P-A3 — `resolveProjectAccess` + keyed GET (absorbs H0.4)** · M · after H1.2, P-A2

- _What:_ new `lib/platform/project-shares-store.ts` (grant lookup, `selectSharedWith`); `resolveProjectAccess` in `require-owner.ts`; `getProject` exposed on the owner store; `[projectId]` GET uses it. Tenant-addressed routes: `/api/tenants/[ownerId]/projects/[id]` with `/api/projects/*` kept as the personal-tenant alias.
- _Exit:_ **Failing-first cross-tenant read:** user in org B requests `(ownerId=A, project=P)` → 403 before any grant exists; the test asserts the 403 **and** asserts the project row exists in A (so the 403 is an authz decision, not a 404 in disguise).

**P-A4 — Share and revoke** · M · after P-A3

- _What:_ `POST /api/tenants/[ownerId]/projects/[id]/shares` `{grantee: "@login" | "@org" | "@org/team", role}`; `DELETE .../shares/[granteeType]/[granteeId]` sets `revoked_at`. Owner-role only. Handle resolution is **exact-match only**; no search endpoint; an unknown handle returns 404 with the same latency as a known one (no enumeration oracle). `GET /api/projects/shared` lists live grants for the caller. Every grant/revoke writes `audit_log`.
- _Exit:_ **Failing-first:** B reads P → 403; A shares with B → 200; A revokes → **next request** 403 with no cache layer in between (test runs both requests against the same process). Audit rows: 2.

**P-A5 — Client: shared-with-me view, no cache** · M · after P-A4, H1.7

- _What:_ `SharedProjectsAdapter` (HTTP only) and a "Shared with me" section in the project list, labelled with owner handle and role. Shared projects are **never** written to IDB: the `hexagen:saved-projects-owner` stamp (H1.7) exists to wipe the cache on owner change, and a cache that mixes tenants defeats it. Read-only grantees get a read-only editor; write grantees get the H1.4 409 → reload-and-merge UI, with the silent retry at `http-saved-projects.adapter.ts:222-240` bypassed.
- _Exit:_ **Failing-first:** after viewing a shared project, `IDBSavedProjectsAdapter.loadProjects()` contains 0 rows with that id (test asserts the shared list had ≥ 1 first). Tenant switch wipes the personal cache exactly as today.

**P-A6 — Write grants: actor identity and run history** · S · after P-A4, H1.4, H1.5

- _What:_ `updated_by` carries the grantee user id; `run_events` gains `actor_id` (nullable; NULL = owner). Runs on a shared project post to the owner tenant (D-A3).
- _Exit:_ **Failing-first:** B writes P → row `updated_by = B`, `rev` incremented by 1; A's `RunHistoryPage` shows the run with B as actor.

**P-A7 — Data export + account deletion respect grants** · S · after H0.2, P-A4

- _What:_ `GET /api/account/export` includes `shares_granted` and `shares_received`. Org deletion revokes every grant it issued and every grant it received, in-transaction.
- _Exit:_ delete org A → `SELECT COUNT(*) FROM project_shares WHERE owner_id = A AND revoked_at IS NULL` is 0, asserted against a pre-count > 0.

## Decisions

| id       | question                                                                                                                                                                                                                                                                               | default if unanswered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-0**  | API host for the new platform routes: Next.js route handlers in `apps/web` (status quo), or a separate `apps/api` Nitro service scaffolded from the repo's own generator (`packages/sync/src/generators/apps-framework-templates.ts`)? — shared gate across all three 2026-08-23 plans | **Status quo.** `resolveProjectAccess`, the tenant-addressed routes (D-A8), and the shares/teams/audit stores land in `apps/web`; D-A9 keeps them async so a later move to Nitro swaps adapters, not callers. **If Nitro is chosen:** the whole of §Authorization moves with the stores (membership and grant resolution must run where the DB is); the JWT verification boundary becomes cross-process (shared `NEXTAUTH_SECRET`, cookie sent via the LB path `/api/*`); and this plan's packets grow by roughly a third — each "add a route handler" becomes handler + client call + web-side removal. The generator producing `apps/api` is real dogfooding: scaffold defects become production defects. |
| **D-A1** | Is a team an owner type (team UUID as `owner_id`) or a grantee grouping only?                                                                                                                                                                                                          | **Grantee only.** A third owner type means three places a project can live and a "move" operation between them; every `projectsFor(owner)` caller must learn a third kind. As a grantee, a team costs one `IN (:teams_of_user)` clause and nothing else. Orgs own; teams receive.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D-A2** | Grant roles                                                                                                                                                                                                                                                                            | **`read` and `write` only.** H1.3 has two org roles for the same reason: 2–10 trusted engineers per team, no v1 buyer for viewer/commenter tiers. Per-project ACL lists beyond grants are out; the grant table _is_ the ACL, with two values.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **D-A3** | Where do runs and telemetry for a shared project land?                                                                                                                                                                                                                                 | **The owner's tenant, stamped with `actor_id`.** A project's history belongs with the project; scattering it across grantees' tenants makes the owner's 14-day trend lie. Cost attribution follows the same rule — which is why `require_byok` (H1.6) is the right lever for orgs that do not want to pay for grantees' runs.                                                                                                                                                                                                                                                                                                                                                                               |
| **D-A4** | Cross-org discovery                                                                                                                                                                                                                                                                    | **None.** Share by exact handle only (`@login`, `@org`, `@org/team`); unknown handles 404 with constant latency. No member or team listing is readable outside the org.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D-A5** | Revocation semantics                                                                                                                                                                                                                                                                   | **Soft (`revoked_at`), immediate, per-request.** No JWT claims carry grants, so no token invalidation is needed. Re-sharing the same grantee clears `revoked_at` rather than inserting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D-A6** | Audit log in v1?                                                                                                                                                                                                                                                                       | **Yes, narrow:** share, revoke, team add/remove. It is five insert sites and one append-only table; not having it means the first "who gave org B access to this" question has no answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D-A7** | Does `PUT /api/projects` (bulk replace) survive?                                                                                                                                                                                                                                       | **Owner-only, unchanged semantics.** It exists for the IDB lift (H1.7). It must never be reachable through a grant — one write grant would otherwise be able to wipe a tenant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **D-A8** | Route shape                                                                                                                                                                                                                                                                            | **Tenant-addressed** `/api/tenants/[ownerId]/projects/[id]` for anything a grantee can reach; `/api/projects/*` stays as the personal-tenant alias so existing clients and tests keep working.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **D-A9** | New store contract: sync (like today's stores) or async?                                                                                                                                                                                                                               | **Async from day one.** Plan 3 (G2.2) found the real cost of the Postgres move is the sync→async contract change across every existing store and its callers, not SQL dialect. `project-shares-store.ts`, `teams`, and `audit_log` (P-A2, P-A4) return Promises from the start — `resolveProjectAccess` is already one request-scoped async step, so this costs nothing — and G2.2 swaps adapters rather than touching callers.                                                                                                                                                                                                                                                                             |

## Sequencing

```
H1.1 orgs schema ──▶ P-A1 github_login ──▶ P-A2 teams ──┐
H1.2 requireTenant ─────────────────────────────────────┼──▶ P-A3 access + keyed GET ──▶ P-A4 share/revoke ──┬──▶ P-A5 client view
H1.4 rev/updated_by ────────────────────────────────────┘                                                   ├──▶ P-A6 actor + runs (needs H1.5)
H0.2 export ────────────────────────────────────────────────────────────────────────────────────────────────┴──▶ P-A7 export/deletion
                                                                                                 Plan 1 (client storage) ─┘ consumes P-A5's "no cache for shared" rule
                                                                                                 Plan 3 (Postgres, D-H4) ── every statement above is SQLite-first; no blocker either way
```

P-A1/P-A2 can run in parallel with H1.2–H1.4. P-A3 is the gate: nothing sharing-related lands before `resolveProjectAccess` exists with its failing-first cross-tenant test.

**SQLite performance note.** `selectSharedWith` joins `project_shares` on `(grantee_type, grantee_id)` for up to (1 user + N orgs + M teams) grantee ids. With the two indexes above this is a handful of index seeks per request; fine at the 2–10-engineer team scale this plan targets. If a single user ever holds thousands of grants the list query becomes the slow path — paginate `GET /api/projects/shared` from day one (limit 100, cursor on `created_at`) so that the fix is a parameter, not a redesign.

## What this plan does not do

| excluded                                  | why                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| SSO / SAML, SCIM                          | Platform-tier promise (2026-08-20 plan, out of scope). Teams here are manual.                                        |
| Fine-grained ACLs (per-file, per-context) | D-A2. Grants are per-project, two roles.                                                                             |
| Realtime co-editing, CRDT, presence       | H1.4's 409 + snapshot model is the conflict story. Out.                                                              |
| Team-owned projects                       | D-A1. Revisit only if a real team asks to own a project no org member should see — that is a new org, not a feature. |
| Public / link sharing                     | Every grantee is an authenticated identity. Anonymous links are a different threat model and their own plan.         |
| Metering changes                          | ADR-0063 freeze. Signed-in metering is H2.3 behind D-H3.                                                             |
| Postgres                                  | Plan 3 / D-H4. Everything here is SQLite-first through the existing store interfaces.                                |

## Risks

| risk                                                                                   | mitigation                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Owner OR grant" passes vacuously** — a test with no cross-tenant row proves nothing | Every P-A3/P-A4 test creates the project in tenant A, asserts the row exists, then asserts B's 403. A test that cannot show the 403 on a real row is not a test of authorization.                 |
| Grant check bypassed by a route that still uses `requirePersistenceOwner` directly     | `grep -rn requirePersistenceOwner app/api` is a CI assertion: the allowed set is the personal-alias routes only; any new match outside it fails the build. The list is in the test, not in prose. |
| Bulk `PUT /api/projects` reachable via a write grant wipes a tenant                    | D-A7; failing-first test: B with write grant on one project calls bulk PUT on A → 403, and A's row count is unchanged (asserted).                                                                 |
| Shared projects leak into the IDB cache and survive a tenant switch                    | P-A5 rule + test that the cache holds zero shared rows after viewing one.                                                                                                                         |
| Handle resolution becomes an enumeration oracle                                        | D-A4; constant-time 404; no search endpoint; test asserts identical status for unknown login vs. known-but-unshareable.                                                                           |
| Invite-by-login impossible because `users` lacks the login                             | Verified gap; P-A1 is first in sequence.                                                                                                                                                          |
| SQLite write contention under a team (single writer)                                   | Already the ADR-0065 reality; grants add few writes. The read side is indexed. If it becomes real, that is Plan 3's trigger (D-H4), not a reason to pre-build.                                    |
| Org deletion leaves dangling grants received from other orgs                           | P-A7 revokes both directions in-transaction; test pre-counts.                                                                                                                                     |

## Ready when

- A user in org B can read and (with `write`) edit a project owned by org A, and loses access on the request after revocation — shown by tests that first prove the row and the grant exist.
- No route outside the personal alias set calls `requirePersistenceOwner`; the CI grep assertion enforces it.
- `audit_log` answers "who shared what with whom, when, and when was it revoked" for every grant in the system.
- BYOK remains per-user (`byok-store.ts` unchanged, diff-asserted) and the eight ADR-0063 files are unchanged.
