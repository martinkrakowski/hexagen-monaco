# ADR-0071: Platform Database Moves from SQLite to Postgres

**Date:** 2026-10-08
**Status:** Accepted (owner decisions, 2026-10-07 and 2026-10-08)
**Type:** Operations
**Amends:** ADR-0064 (Deploy Topology Is Single-Container), ADR-0065 (Single-Container Compose Deployment)
**Relates to:** ADR-0063 (quota metering freeze, untouched); ADR-0070 (account-required gate); ADR-0030 (BYOK, amended separately on the same date); `docs/planning/2026-10-07_indexeddb-to-postgres-migration-plan.md` ("the plan")

> Citations in this ADR name a row of the plan's section 8, for example "(plan §8, D-4, decided 2026-10-08)". A sentence with no such citation is a fact about the code or about an existing ADR, with the path given.

## Context

The server keeps three SQLite files, opened with `better-sqlite3`, on one volume mounted at `/data`: `platform.db`, `byok.db` and `quota.db` (plan §2.2, read at `origin/main`).

ADR-0064 and ADR-0065 tie the deployment to that choice. They say a Postgres cutover needs an amendment first. These are the sentences this ADR changes.

From `ADR-0064-deploy-topology-single-container.md`, line 22, in the Context section:

> The database story for >1 process (Postgres, tenancy) is Phase 2 work, gated on this topology decision.

From the same file, line 36, the last paragraph of the Decision section:

> A second replica, a shared SQLite, or a Postgres cutover is out of scope. Those are Phase 2, and they require amending this ADR first. ADR-0063 continues to freeze metering _behavior_; this ADR only makes the existing SQLite files survive a pod.

From the same file, line 41, in Consequences:

> Phase 2 persistence / tenancy work honors this topology: schema lands on the single-container SQLite (or an explicit successor decided later), not on an assumed multi-replica cluster.

From `ADR-0065-single-container-compose-deployment.md`, line 13, in the Decision section:

> We commit to a single-container Docker compose deployment until Phase 2 multi-tenancy is built.

From the same file, line 18, the negative consequence:

> We cannot scale out horizontally to multiple nodes until Phase 2 multi-tenancy is implemented with an appropriate distributed database or replication strategy.

The owner decided on 2026-10-08 to amend both ADRs to allow a Postgres cutover and to record it in this ADR (plan §8, D-2, decided 2026-10-08). The owner also decided the scope: both moves of the plan, in the order of its section 7 (plan §8, D-1, decided 2026-10-08).

Facts about the code that bear on the decision:

- There is no migration runner. `apps/web/lib/platform/platform-db.ts` runs `CREATE ... IF NOT EXISTS` and column probes on every open (plan §2.2).
- Production holds no user rows. The plan read the production volume on 2026-10-08: the user, project, run, entitlement, BYOK and quota tables have 0 rows (plan §2.3).
- `quota.db` is read through `apps/web/lib/enforce-quota.ts`, which ADR-0063 freezes (plan §5, B1 "Not included"; `ADR-0070-account-required-hard-auth-gate.md`, lines 13 to 14).

## Decision

**The platform database moves from SQLite to Postgres.** `platform.db` and `byok.db` become one Postgres database (plan §1, Move B; plan §8, D-1, decided 2026-10-08).

### Where Postgres runs

- Production Postgres is set up by the owner, with no date. Production deployments are frozen until it exists. The plan needs from it a `DATABASE_URL` and a tested restore (plan §8, D-3, decided 2026-10-07).
- Staging gets its own Postgres cluster on the staging host now. The manifests are prepared in their own pull request and applied when the owner says (plan §8, D-3s, decided 2026-10-07).
- Staging is the only deploy target while the freeze lasts (plan §7, citing D-3).

### Tooling

- Migrations are an in-repo runner with a `schema_migrations` table and numbered SQL files. The database client is raw `pg` with a thin query layer. No ORM is used (plan §8, D-4, decided 2026-10-08).
- Applied migrations are forward-only. The runner's bookkeeping table is a format every later migration depends on (plan §8, D-4, "Hard to undo", decided 2026-10-08).

### Column types

- Timestamps are `timestamptz`. Flags are `boolean`. Stored JSON payloads are `jsonb`. Ids stay `text` (plan §8, D-5, decided 2026-10-08).
- A test pins the invite-expiry comparison. Today it compares strings. On Postgres it compares times, so its meaning changes (plan §8, D-5, decided 2026-10-08).
- These types are the on-disk format. Changing them later is a migration over live data (plan §8, D-5, "Hard to undo", decided 2026-10-08).

### SQLite after the cutover

- SQLite stays for local development and unit tests for one release. It is never a backend for any deployment (plan §8, D-6, decided 2026-10-08).
- An in-process Postgres is measured at packet B2, so the project can drop to one dialect (plan §8, D-6, decided 2026-10-08).

### `quota.db`

- `quota.db` stays on SQLite for this plan. ADR-0063's freeze is untouched (plan §8, D-7, decided 2026-10-08).
- `quota.db` is therefore still one file on one volume. Re-keying it from the anonymous cookie to the user id is the next plan, and the old counters cannot be mapped to users (plan §8, D-7, decided 2026-10-08).

### Test database on the shared test server

- The role is `hx_test`. The database prefix is `hx_`. One database, `hx_concurrency`, is kept for the two-writer tests (plan §8, D-11, decided 2026-10-08).
- The host steps are prepared when the work reaches B2 (plan §8, D-11, decided 2026-10-08).

### Cutover

- The cutover is one-way. There is no Postgres-to-SQLite export. It rests on a staging rehearsal of the ETL and a tested Postgres restore (plan §8, D-13, decided 2026-10-08).
- Production has no rows to carry. Its step is to run the migrations against the empty database on the first deploy after the freeze. The row counts are read again at that moment, and if a table is no longer empty, production gets the same ETL as staging (plan §5, B4, citing D-3; plan §8, D-13, decided 2026-10-08).
- The SQLite files are kept read-only for 30 days after the staging cutover (plan §5, B4).

### Effect on ADR-0064 and ADR-0065

- The Postgres cutover that ADR-0064 line 36 puts out of scope is now in scope, and the amendment that line requires is this ADR (plan §8, D-2, decided 2026-10-08).
- The SQLite-on-a-volume clauses of ADR-0064 line 41 and ADR-0065 line 9 and line 18 describe the old backend. For the platform data they are replaced by this ADR. They stay true for `quota.db` (plan §8, D-7, decided 2026-10-08).
- This ADR does not change the replica count. The single-container clauses stay in force, because `quota.db` and the in-process rate limiter in `apps/web/lib/rate-limiter.ts` still depend on one process (plan §8, D-7, decided 2026-10-08; `ADR-0064-deploy-topology-single-container.md`, line 20).

## Consequences

- Every store interface becomes asynchronous and every store gets one seam over two backends. The change touches every authenticated route, so a missed `await` on an access guard is a security fault. The plan names a lint rule as the mitigation (plan §10, first risk; plan §5, B1).
- The migration runner and the column types cannot be changed cheaply after the first applied migration (plan §8, D-4 and D-5, decided 2026-10-08).
- The cutover cannot be undone after users write to Postgres. A restore from a Postgres backup is the only way back (plan §8, D-13, decided 2026-10-08).
- Production stays on its current build until the owner's database exists. Anything merged since, including security fixes, is on staging only (plan §10, "The freeze holds back fixes as well as features", citing D-3).
- Staging rollback does not revert schema, so the SQLite files are kept for 30 days (plan §10; plan §5, B4).
- The project carries two dialects for one release, then may carry one (plan §8, D-6, decided 2026-10-08).
- `quota.db` keeps the app pinned to one instance until the next plan (plan §8, D-7, decided 2026-10-08).

## What this does not decide

- Where production runs in detail. Only `DATABASE_URL` and a tested restore are needed from it (plan §8, D-3, decided 2026-10-07).
- Move A, the browser-to-server move, and its `owner_documents` table. Its key and its access rule are plan decisions D-12 and D-14, and they belong to the plan, not to this ADR (plan §8, D-12 and D-14, decided 2026-10-08).
- Removing SQLite from the repository entirely. D-6 allows it only after the one-release period and the B2 measurement (plan §8, D-6, decided 2026-10-08).
- Moving `quota.db` or re-keying it. That needs a change to ADR-0063 (plan §8, D-7, decided 2026-10-08).
- A second replica or a second node. Nothing here lifts that limit.
- Where scan artifacts under `/data/scan-artifacts` live. They are files, not rows, and stay on the volume unless D-3 puts the application somewhere without one (plan §5, B5).
