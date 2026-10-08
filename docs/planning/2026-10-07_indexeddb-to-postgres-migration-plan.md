# IndexedDB to Postgres: migration plan

**Date:** 2026-10-07
**Status:** plan. Merging this document adopts nothing by itself; §8 records which decisions the owner has made and when, and which is still open.
**Decided on 2026-10-07, after the first draft:** the owner froze production deployments until he has set up a production database himself (D-3); staging is the only deploy target meanwhile; and staging gets a Postgres (D-3s). Every other row of §8 is still open. §2.3 and the notes marked _freeze_ below say what those decisions change.
**Decided on 2026-10-08:** the owner accepted the recommendations put to him for every other row of §8 in one sentence, "Go ahead with all your recommendations". Each row now says what was decided; three differ from this plan's first recommendation (D-5 adds a test, D-6 is narrower, D-8 settles chat history). D-12 was settled the same day in a second sentence, "Go with option 3 for D-12" (§8.1). **No row of §8 is open now except D-3**, the owner's own production database.
**Baseline:** `origin/main` @ `04458ec4`. Every file and line reference below was read at that commit.
**Input:** the owner's instruction, "write a migration plan for IndexedDB to Postgres".
**Supersedes in part:** `2026-08-23-client-storage-to-server-plan.md` (packets P1.0 to P1.7) and the database tier of `2026-08-23-gcp-migration-plan.md` (packets G2.1, G2.2, G2.4). §3 says which of their packets landed, which this plan carries forward, and which it drops.

## 1. What the ask means in this codebase

The browser does not talk to a database, and most of what users think of as "their projects in IndexedDB" already left it. So the instruction resolves into two moves that share one destination.

- **Move A, browser to server.** The data that still lives only in a browser (editor buffers, governance threads, drafts, canvas layout) gets a server store and follows the account. Local-model chat history is the exception: D-8 abandons it after offering a download.
- **Move B, SQLite to Postgres.** Two of the server's three SQLite files (`platform.db` and `byok.db`) become one Postgres database. The third, `quota.db`, stays where it is unless D-7 says otherwise.

Saved projects are the proof that this is the right reading. `apps/web/app/lib/wire.client.ts:136-141` wires `CachedSavedProjectsAdapter(IDBSavedProjectsAdapter, HttpSavedProjectsAdapter)` with the comment "server sqlite is authoritative; IDB is the local cache". The full project body is in `saved_projects.payload` on the server (`apps/web/lib/platform/saved-projects-store.ts:227`). Pointing IndexedDB "at Postgres" therefore means finishing Move A for the remaining stores and doing Move B underneath all of them.

This reading is decision **D-1**. The alternatives are Move B alone (leave browser-only data where it is) or Move A alone (keep SQLite). The plan is written so either half can be taken without the other; §7 gives the order when both are taken.

**What does not move.** Preferences and caches stay in the browser: theme, panel sizes, the last-used model, the model-verification cache, and the local model weights (which are in the Cache API, not IndexedDB). They cost a click to lose and a round-trip to fetch. The August plan made the same call as its D-S1; this plan keeps it and keeps that plan's allow-list test (§6, A0) as the enforcement.

## 2. What exists today

### 2.1 In the browser

All IndexedDB access goes through `idb-keyval`'s default store: one database `keyval-store`, one object store `keyval`. There is no IndexedDB version or upgrade code.

| Store                                            | Contents                                                                             | Server copy today  | Class                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------ | --------------------------------------- |
| IDB `hexagen:saved-projects`                     | the whole `SavedProject[]` array                                                     | yes, authoritative | mirror of the server                    |
| IDB `hexagen:workspace:<projectId>`              | `PersistedEditorWorkspace`: full text of every edited generated file, and `unpushed` | none               | **durable, browser-only**               |
| IDB `hexagen:chat-history`                       | `ChatMessage[]`, one key for the whole origin                                        | none               | **durable, browser-only**               |
| IDB `hexagen:governance:<contextKey>`            | `GovernanceEntry[]` per question                                                     | none               | **durable, browser-only**               |
| IDB `hexagen:generation:<name>-<timestamp>`      | a full generated file tree per run                                                   | none               | cache; no reader exists in app code     |
| IDB `hexagen:wizard-draft:default`               | `WizardDraft`                                                                        | none               | legacy; only a migration step writes it |
| localStorage `hexagen-brownfield-draft:*`        | `BrownfieldDraft`, 7-day expiry                                                      | none               | **durable, browser-only**               |
| localStorage `hexagen-canvas-layout-<sessionId>` | node positions                                                                       | none               | **durable, browser-only**               |
| localStorage `hexagen-active-workspace`          | a copy of form state and manifest                                                    | n/a                | stale duplicate of project data         |
| localStorage settings, caches, migration flags   | model and AI-setup choices, verification flags                                       | none               | stays local                             |
| Cache API `webllm/*`                             | model weights, multi-gigabyte                                                        | none               | stays local                             |

Four facts shape Move A.

- **Every durable store already sits behind a port** (`EditorWorkspacePersistencePort`, `ChatPersistencePort`, `CanvasLayoutPersistencePort`, and so on), except the brownfield draft and the active-workspace copy, which React code reads directly.
- **The lift pattern exists once.** `CachedSavedProjectsAdapter.loadProjects` (`apps/web/app/lib/adapters/http-saved-projects.adapter.ts:385-400`) uploads a browser's projects exactly once, guarded by `project_owner_state.initialized` on the server and by an owner stamp in the browser that stops one account's cache being uploaded as another's.
- **Keys are not consistently scoped.** Chat history is one key per origin, with no user or project in it. Governance keys carry no project id. Generation keys use the workspace name, not the project id. The cascade delete `purgeProjectData` (`packages/local-llm/src/infrastructure/adapters/idb-chat-persistence.adapter.ts:118-146`) therefore matches only the workspace key of the four shapes it tries to delete.
- **No secret is persisted in the browser as wired.** The plaintext API key is held in memory only. Two adapters that would persist secrets (`LocalStorageByokStoreAdapter`, `EncryptedSessionVaultAdapter`) are never constructed.

The app does not work signed-out (`apps/web/middleware.ts:145-158`, ADR-0070), so every browser that holds data also has an account to attach it to. That removes the anonymous question the August plan had to carry.

### 2.2 On the server

Three SQLite files, opened with `better-sqlite3`, on one volume mounted at `/data`.

| File          | Holds                                                    | Tables                                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.db` | accounts, tenancy, projects, run history, scans, billing | `users`, `accounts`, `sessions`, `verification_tokens`, `orgs`, `org_members`, `org_invites`, `teams`, `team_members`, `audit_log`, `project_shares`, `saved_projects`, `run_events`, `model_prices`, `project_owner_state`, `entitlements`, `scan_records`, `repair_runs`, `repair_attempts` |
| `byok.db`     | key metadata and revocations; no ciphertext              | `byok_key_metadata`, `byok_revocations`                                                                                                                                                                                                                                                       |
| `quota.db`    | free-tier metering keyed by the anonymous session cookie | `quota_usage`                                                                                                                                                                                                                                                                                 |

Scan artifacts are files under `/data/scan-artifacts`, referenced by `scan_records.artifact_path`.

Five facts shape Move B.

- **There is no migration runner.** `openPlatformDb` (`apps/web/lib/platform/platform-db.ts`) runs `CREATE … IF NOT EXISTS` and column-presence probes on every open. The August plans say migrations use `PRAGMA user_version`; the code does not.
- **Half the store interfaces are synchronous.** `AuthRepository`, `EntitlementRepository`, `RunHistoryRepository`, `ScanRecordsStore`, `RepairTelemetryStore`, `OwnerStateStore`, `QuotaStore` and three methods of `SavedProjectsStore` return values, not promises. The orgs, teams, shares, audit and BYOK stores are already async.
- **Transactions are synchronous closures over one shared handle.** `db.transaction(fn)` appears in the saved-projects, shares, orgs, teams, scan and quota stores. Two helpers (`prepareAuditAppend`, `prepareShareRevokeAllForProject`) are called inside other stores' transactions and work only because every store holds the same connection.
- **Two write paths are safe today only because there is one process:** the check-then-insert in `createProjectRecord` (`apps/web/lib/platform/saved-projects-store.ts:307-328`) and the BYOK `write_seq` computed in-statement (`apps/web/lib/byok-store.ts:127,135`). The `rev` check on a project update is a single compare-and-set statement (`saved-projects-store.ts:171-182`) and carries over as it is.
- **Nothing is backed up.** No backup step exists in `.github/workflows/deploy.yml` or `deploy/docker-compose.prod.yml`. The staging README says "we rely on backups" and describes a manual copy.

The deployment is one container (production: Docker compose on a VPS; staging: one replica on k3s with a `ReadWriteOnce` volume). ADR-0064 line 36 says a Postgres cutover "require[s] amending this ADR first".

### 2.3 What production and staging hold today

Read from the production container on 2026-10-08 at about 00:20 UTC, read-only. It runs version 0.13.0, built on 2026-10-02.

- The three SQLite files exist on the production volume and hold **no user data**: `users`, `accounts`, `sessions`, `saved_projects`, `run_events`, `entitlements`, `project_owner_state`, `byok_key_metadata`, `byok_revocations` and `quota_usage` each have 0 rows. The only rows are the 3 seeded `model_prices`.
- `platform.db` was last written on 2026-08-19 and still has the schema from before accounts (no `orgs`, `teams` or `project_shares` tables). The file is opened on the first signed-in request, so no signed-in request has reached production since the account gate shipped.
- So the owner's description, "a production deployment but no database", is exact in the sense that matters: there is no database server and nothing in the files.

Two consequences, in opposite directions.

- **Production has nothing to carry over.** Its cutover is "start on Postgres", not an ETL.
- **Nobody's projects have ever been lifted on production.** Any real user's work from before the account gate exists only in that user's browser. The one-time browser-to-server lift is the only path that data has to the server, and it has not run for anyone.

Staging is the only environment with server-side data, and the only one that deploys until the freeze ends.

## 3. What the August plans already delivered

| August packet                                                      | State at this baseline                                                                                | This plan                                                                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.4 `rev` on `saved_projects`, no silent retry                    | landed (#656)                                                                                         | relies on it                                                                                                                                |
| P1.6 `GET /api/account/export`                                     | landed for projects, runs and entitlement (#653); no browser-only data, because none is on the server | extends it in A4                                                                                                                            |
| D-S2 anonymous users                                               | closed by ADR-0070 (#661): an account is required                                                     | not reopened                                                                                                                                |
| P1.0 allow-list test                                               | not built                                                                                             | carried forward as A0                                                                                                                       |
| P1.1 `owner_documents`, P1.2 routes, P1.3 cached adapters          | not built                                                                                             | carried forward as A1 to A3, with the scoping fixes of §2.1 added and three kinds dropped (`wizard-draft`, `generation`, `monaco`; see D-8) |
| P1.5 offline outbox (its D-S5 chose the outbox)                    | not built                                                                                             | decision D-9, whose recommendation **reverses D-S5**                                                                                        |
| D-S4 keep the last 10 generation results per project on the server | not built                                                                                             | **reversed**: D-8 recommends abandoning them, because nothing reads them                                                                    |
| P1.7 remove dead adapters                                          | not built                                                                                             | carried forward as A5                                                                                                                       |
| G2.2 async contracts and a `pg` implementation                     | not built                                                                                             | carried forward as B1 and B2                                                                                                                |
| G2.4 one-shot ETL                                                  | not built                                                                                             | carried forward as B4                                                                                                                       |
| G2.1 Cloud SQL, G2.5 artifacts to a bucket                         | not built; the hosting move they belong to has not happened                                           | **dropped from this plan.** Where Postgres runs is decision D-3, and this plan is written against a `DATABASE_URL`, not a provider          |

## 4. Target

One Postgres database holds everything `platform.db` and `byok.db` hold today, plus one new table for the browser-only data. The application reaches it through the store interfaces it already has, made async. SQLite remains a supported backend for local development and for the fast unit tests until the owner retires it (D-6).

**The wire format does not change.** A project is the same JSON body, addressed by the same routes, with the same `"rev:<n>"` ETag. Browsers on an old bundle keep working across the cutover.

**The on-disk format does change, once.** Today timestamps are ISO-8601 text in some tables and epoch milliseconds in others, booleans are `0/1` integers, and JSON is text. The Postgres schema is the one chance to choose (D-5).

**New table for Move A**, carried from the August plan with two changes: a `project_id` column, so that a project's deletion reaches its documents, and a shorter list of kinds (the August list also had `wizard-draft`, `generation` and `monaco`, which §8 D-8 proposes to abandon). The key was decision D-12, settled as §8.1's option 3:

```sql
owner_documents (
  owner_id    text    not null,
  kind        text    not null,  -- workspace | governance | brownfield-draft | canvas-layout
  user_id     text    not null,  -- the author; equal to owner_id for a personal tenant
  id          text    not null,
  project_id  text,              -- null for kinds that are not per project
  rev         integer not null,
  payload     jsonb   not null,
  updated_at  …,                 -- type per D-5
  updated_by  text,
  primary key (owner_id, user_id, kind, id)
)
```

## 5. Move B: SQLite to Postgres

Sizes: S is up to half a day, M up to two days, L more. Each packet is one lane and one pull request.

**B0. Backups and a restore drill, on SQLite, before anything else** · S
The ETL in B4 is only reversible if the SQLite files it reads can be restored. Add a scheduled online backup of the three files to somewhere off the volume, for production and staging, and restore one into a scratch container. The image has no `sqlite3` binary, so the backup is `better-sqlite3`'s own `.backup()` run with `node`.
_Done when:_ each of the three files is restored from last night's backup and checked on its own data: `platform.db` serves a signed-in user's project list, `byok.db` returns a known key's metadata and revocation state, and `quota.db` returns a known session's count for the day.

**B1. Async store contracts and a connection seam, still on SQLite** · L
Make every method in the sync rows of §2.2 return a promise, and port the roughly 20 files that call `getPlatformStore()`. Replace the `Database.Database` parameter in each store factory with a small interface the platform owns (`query`, `execute`, `transaction(async fn)`), implemented first over `better-sqlite3`. Move the two cross-store helpers onto the transaction object so they no longer depend on a shared connection.
_The SQLite side of `transaction(async fn)` cannot be `better-sqlite3`'s own `db.transaction`:_ that helper refuses an async callback outright (`TypeError: Transaction function cannot return a promise`). On SQLite the seam issues `BEGIN IMMEDIATE`, awaits the callback, then `COMMIT` or `ROLLBACK`, and runs one transaction at a time on the single connection. (An earlier draft of this plan said the helper would commit at the first `await`; it does not, it throws. The conclusion is the same.)
_Done when:_ the roughly 40 existing store and route test files pass unchanged in behaviour; a test asserts each interface method returns a `Promise`; a transaction whose callback rejects after an `await` leaves no row behind, on SQLite, and fails if the seam is switched to `db.transaction`.
_Not included:_ `QuotaStore`. `apps/web/lib/enforce-quota.ts:59` calls `consume()` synchronously and ADR-0063 freezes that file. See D-7.

_B1 is delivered in five lanes, each landing alone and in this order_ (decided while executing, 2026-10-08, because the packet is far larger than one lane):

- **B1a, the seam** (merged, #778): `PlatformDb` and `PlatformDbSession` in `apps/web/lib/platform/db.ts`, the SQLite implementation, and owner state as the first store on it.
- **B1L, the lint:** type-aware `no-floating-promises`, `no-misused-promises` and `await-thenable` for the web app's server code, before any more methods turn async. This is the mitigation the risk section names.
- **B1L2, the rule the standard ones lack:** B1L's own check showed that a missing `await` is reported by neither those rules nor the type checker when the promise lands where any value is accepted, such as a JSON response body. A small custom rule in the repository's ESLint plugin reports a promise passed where the expected type is `any` or `unknown`.
- **B1b, the interfaces:** every remaining synchronous store method returns a promise and every caller awaits it, with the implementations still on the raw handle. This is the lane that touches the guards.
- **B1c, the implementations:** every store moves from the raw handle to the seam in ONE lane, transactions and the two cross-store helpers included.

_Why B1c is one lane:_ **no production code may open a seam transaction while any store still uses the raw handle.** All stores share one SQLite connection. A seam transaction stays open across `await`s, and in those gaps another request's code runs. If that code is a raw-handle store, its statements execute inside the open transaction, and its own `db.transaction` silently becomes a savepoint in it (the driver does this when a transaction is already open), so a write that reported success is rolled back if the seam transaction fails. The seam carries a tripwire for this (it refuses to begin when the connection already has a transaction open), but the tripwire catches only one direction. So the stores that use transactions cannot move one at a time.

_What the seam's contract already fixes for B2:_ statements use `?` with an array or `@name` with a record, and an implementation accepts both; `isUniqueViolation(error)` replaces matching the SQLite error code; a store method that must join another store's transaction takes an optional `session` argument; and `transaction` promises all-or-nothing, but NOT isolation from other transactions on a pooled implementation, so a read-then-write inside it has to say how it is protected.

**B2. Postgres implementation, a migration runner, and one contract suite for both backends** · L
A `pg` implementation of the B1 seam, selected when `DATABASE_URL` is set. A migration runner with a `schema_migrations` table and numbered SQL files replaces the probe-on-open code for Postgres (D-4). One contract suite runs every store against both backends.
The dialect work is a known list, each item a test in the suite:

- `strftime` and `datetime(…, 'unixepoch')` (`platform-db.ts:444`, `run-history-store.ts:166`);
- `COLLATE NOCASE` on `github_login` (`platform-db.ts:76,139`);
- the two `RAISE(ABORT)` triggers that keep org ids and user ids disjoint (`platform-db.ts:94-107`);
- `rowid` as an insertion-order tie-break and `LIMIT -1 OFFSET` (`scan-records-store.ts:461-499`, `repair-telemetry-store.ts:679-691`);
- `@name` parameters and dynamic `IN (?, ?, …)` lists;
- `INSERT OR IGNORE` for the price seed (`platform-db.ts:633`);
- error handling that matches `SQLITE_CONSTRAINT_UNIQUE` and a message regex (`orgs-store.ts:264-279`, `teams-store.ts:262-269`);
- idempotency checks that read `.changes` (`orgs-store.ts:444-446`).

_Done when:_ the contract suite is green on both backends; breaking one column name in a Postgres statement turns it red on Postgres only.

**B3. Close the two single-process races** · M
With more than one connection, the two unguarded paths of §2.2 become real races. Put the check-then-insert in `createProjectRecord` inside a transaction (or lean on the primary key and handle the conflict), and replace the BYOK `write_seq` subquery with a sequence.
_Done when:_ a two-writer test against a real Postgres server shows exactly one winner for each path, and fails when the guard is removed.

**B4. ETL and cutover** · M
A script reads the SQLite files read-only and writes through the store interfaces into Postgres, so it is exercised by the B2 suite. It is idempotent. On staging it runs inside a write freeze. _Freeze:_ production has no rows to carry (§2.3), so its step is to run the migrations against the empty production database on the first deploy after the thaw. The row counts are read again at that moment; if any table is no longer empty, production gets the same ETL as staging.
_Done when:_ for every table, the set of primary keys matches and a hash of each row's canonical content matches (types normalised per D-5 before hashing), with the per-table counts and mismatch counts printed in the pull request; as a smoke test on top, one signed-in user's project list is byte-identical before and after; the SQLite files are kept read-only for 30 days.
_The way back:_ those files hold nothing written after the cutover. Returning to SQLite after users have written to Postgres needs a reverse export, written and rehearsed as part of this packet, or the cutover is accepted as one-way. That is decision D-13. It applies to staging; for production it falls away while the files are empty.

**B5. Scan artifacts** · S
The files under `/data/scan-artifacts` are not rows and are not moved by B4. They stay on the volume unless D-3 puts the application somewhere without one.

## 6. Move A: browser-only data to the server

**A0. Allow-list test for storage keys** · S
A test that finds every storage key literal in the app and the three packages that persist, and requires each to be in a `DATA_KEYS` list (must have a server store when this plan is done) or a `PREFERENCE_KEYS` list (stays local).
_Done when:_ the test first fails if its scan finds no keys at all, or fewer than the keys of §2.1; then adding a new `localStorage.setItem` key anywhere turns it red.

**A1. Scope the keys before moving them** · M
Fix what §2.1 found, in the browser, first: governance threads keyed by project; generation results keyed by project id; `purgeProjectData` (its `purgeProjectDataAtomic` helper) matching the keys the app really writes. Chat history is not scoped or moved: D-8 abandons it after a one-time download, which is built here. Moving unscoped data to a server keyed by owner would turn "one browser's chat" into "the account's chat" by accident.
_Done when:_ deleting a project in a test leaves no key of that project in the store.

**A2. `owner_documents` store and routes** · M
The table of §4, a store with `list`, `get`, `put(expectedRev)` and `delete`, and routes with the same guards as the project routes (the owner guard in `apps/web/lib/platform/require-owner.ts`, same-origin, rate limit, `If-Match`). D-14 decided that access is owner-only at first: under §8.1's recommended key that means the author only, and someone a project is shared with reads none of its documents.
_Done when:_ a stale `If-Match` returns 409; a second tenant reads nothing; within one org, a second member reads nothing of the first member's documents; removing a member deletes that member's documents under the org and nobody else's.

**A3. Cached adapters and the one-time lift, per kind** · L
For each durable kind, an HTTP adapter and a cached adapter of the shape `CachedSavedProjectsAdapter` already has, with the owner stamp extracted into one shared helper. The brownfield draft has no port today (React code reads localStorage directly), so it gets one first. The lift flag generalises from `project_owner_state(owner_id)` to `(owner_id, kind)`.
Order, by what is lost if the browser's copy disappears: editor workspace, brownfield draft, governance threads, canvas layout. Chat history is not lifted (D-8).
_Done when, per kind:_ an empty server and a non-empty browser lift exactly once; a browser stamped for another owner is wiped and lifts nothing.

**A4. Account export covers documents** · S
`GET /api/account/export` gains every `owner_documents` kind.
_Done when:_ a test owner with one row of each kind gets all of them; the assertion is on the set of kinds.

**A5. Remove what is dead** · S
Delete the two unwired secret adapters, the write-only generation-result store (D-8), and the legacy localStorage migration steps once D-8 allows. Retire `hexagen-active-workspace` as a second copy of project data: its readers take the project from the saved-projects port. The Monaco session adapter is wired but appears to have no caller; confirm, then delete it too. _Freeze:_ nothing that a production browser may still need is removed before the thaw; see D-8.

## 7. Order

```
B0 ─► B1 ─► B2 ─► B3 ─► B4 (staging) ─► B4 (production)
A0 ─► A1 ─► A2 ─► A3 ─► A4 ─► A5
```

- B0, A0 and A1 need no further decision and can start at once.
- B1 and B2 have their decisions (D-1, D-2, D-4, D-5). The ADR amendments of D-2 are written before B2 merges.
- A2 is written async against the B1 seam, so it comes after B1. It must land either before B2 starts or after B2 merges, never during: a store added while the Postgres implementation is being written is ported twice. The August hosting plan made the same point about its own companions. D-12 is decided, so A2 may fix the key.
- Every packet through B4 is proved on staging, which is the only deploy target during the freeze. The production step waits on the owner's production database (D-3) and is small (§2.3).
- Recommended order: B0 and A0; A1; B1; A2 (over SQLite); B2 and B3; B4 on staging; A3 and A4; then, at the thaw, production starts on Postgres; A5 last. That puts the contract change, which is the expensive part, before any new store is added to it, rehearses the ETL with the new table already in it, and keeps every browser-side lift in the code until production browsers have had the chance to use it.

## 8. Decisions for the owner

Each row names who chooses. "Hard to undo" marks a one-way door.

| #        | Decision                                                                                                                                                                                                                                         | Recommendation                                                                                                                                                                                                                                                                                                              | Hard to undo?                                                                                                                                                                                                         | Chooses               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **D-1**  | Scope: both moves, Move B only, or Move A only                                                                                                                                                                                                   | **Decided 2026-10-08.** Both, in the §7 order                                                                                                                                                                                                                                                                               | No: each packet stands alone                                                                                                                                                                                          | owner                 |
| **D-2**  | ADR changes: amend ADR-0064 and ADR-0065 to allow a Postgres cutover (a new ADR-0071), and amend ADR-0030, which still names the browser `ByokStore` and `LocalStorageByokStoreAdapter` as the ciphertext store although nothing constructs them | **Decided 2026-10-08.** Yes to both, written before B2 merges. The ADR-0030 amendment records what the code already does (the key is held in memory only); it does not move ciphertext to the server                                                                                                                        | No, but it is the gate the ADRs themselves set                                                                                                                                                                        | owner                 |
| **D-3**  | Where production Postgres runs                                                                                                                                                                                                                   | **Decided 2026-10-07: the owner sets it up himself; no date.** Production deployments are frozen until it exists. The plan needs from it only a `DATABASE_URL` and a tested restore                                                                                                                                         | **Yes.** Moving a live database between hosts later is a second cutover                                                                                                                                               | owner                 |
| **D-3s** | Whether staging gets its own Postgres cluster on the staging k3s host                                                                                                                                                                            | **Decided 2026-10-07: yes, now.** Manifests are prepared in `deploy/k8s/staging/postgres/` (their own pull request), applied when the owner says                                                                                                                                                                            | No                                                                                                                                                                                                                    | owner (host decision) |
| **D-4**  | Migration tooling: a small in-repo runner with numbered SQL files, or a library; raw `pg` with a thin query layer, or an ORM                                                                                                                     | **Decided 2026-10-08.** In-repo runner and raw `pg`. An ORM would move the schema's source of truth out of SQL and rewrite 19 tables' worth of working statements                                                                                                                                                           | **Yes.** Applied migrations are forward-only, and the runner's bookkeeping table is a format every later migration depends on                                                                                         | owner                 |
| **D-5**  | Column types in Postgres: `timestamptz` or keep text and epoch integers; `boolean` or `0/1`; `jsonb` or text for `payload`                                                                                                                       | **Decided 2026-10-08.** `timestamptz`, `boolean`, `jsonb`; ids stay `text` With a test that pins the invite-expiry comparison, since its meaning changes from a string comparison to a time comparison.                                                                                                                     | **Yes.** It is the on-disk format; changing it later is a migration over live data. It also changes ordering semantics for the invite-expiry comparison, which today compares strings                                 | owner                 |
| **D-6**  | After cutover, is SQLite still a supported backend                                                                                                                                                                                               | **Decided 2026-10-08.** SQLite stays for local development and unit tests for one release, and is never a backend for any deployment. In-process Postgres is measured at B2, so the project can drop to one dialect.                                                                                                        | No                                                                                                                                                                                                                    | owner                 |
| **D-7**  | `quota.db`: leave on SQLite (one instance forever), or lift ADR-0063's freeze and move it, re-keyed from the anonymous cookie to the user id that ADR-0070 left open                                                                             | **Decided 2026-10-08.** Leave it for this plan. (Production's `quota_usage` has 0 rows today, so a re-key during the freeze would lose nothing there.) It is the only thing pinning the app to one instance, so it is the next plan, not this one                                                                           | Re-keying is **yes**: old counters cannot be mapped to users                                                                                                                                                          | owner                 |
| **D-8**  | What happens to data users already hold in their browsers, per kind (table below)                                                                                                                                                                | **Decided 2026-10-08.** The table below as written, with chat history settled: abandon it, after offering a one-time download of the transcript.                                                                                                                                                                            | **Yes** for every "abandon": once the adapter is removed the data is unreachable                                                                                                                                      | owner                 |
| **D-9**  | Offline writes after Move A: an outbox that replays on reconnect, or read-only when offline                                                                                                                                                      | **Decided 2026-10-08.** Read-only when offline, stated in the UI. This reverses the August plan's D-S5, which chose the outbox because read-only is a step back from today for a user with no network. The case for reversing: an outbox makes two-device conflicts routine, and can be added later without a format change | No                                                                                                                                                                                                                    | owner                 |
| **D-10** | Does IndexedDB remain as the read cache after cutover                                                                                                                                                                                            | **Decided 2026-10-08.** Yes (ADR-0070 says so today). Removing it is a separate, later choice                                                                                                                                                                                                                               | No                                                                                                                                                                                                                    | owner                 |
| **D-11** | Test database role and prefix on the shared lane server (§9)                                                                                                                                                                                     | **Decided 2026-10-08.** `hx_test`, `hx_`, one kept database `hx_concurrency` The host steps are prepared when the work reaches B2.                                                                                                                                                                                          | No                                                                                                                                                                                                                    | owner (host step)     |
| **D-12** | `owner_documents`: who owns a document, and so its primary key                                                                                                                                                                                   | **Decided 2026-10-08: option 3 of §8.1.** The key is `(owner_id, user_id, kind, id)`: a tenant (a user or an org) owns the row, and only the author reads and writes it for now. The three commitments listed in §8.1 were chosen with it, unchanged                                                                        | **Yes.** The key and the kind names are in every stored row and every route path. One commitment destroys data: a member who leaves or is removed from an org loses their documents under it, unpushed edits included | owner                 |
| **D-13** | The way back after the production cutover: write and rehearse a Postgres-to-SQLite export, or accept the cutover as one-way                                                                                                                      | **Decided 2026-10-08.** Accept it as one-way, on the strength of the staging rehearsal and a tested Postgres restore. A reverse export is a second ETL to maintain for a path that should never run                                                                                                                         | **Yes.** This is the cutover itself                                                                                                                                                                                   | owner                 |
| **D-14** | Can someone a project is shared with read or write its documents (editor buffers, governance threads, drafts)                                                                                                                                    | **Decided 2026-10-08.** Owner-only at first. Shared editing of buffers is a product feature with its own conflict rules, not a side effect of a storage move. The August plan also left document tenancy to the tenancy plan                                                                                                | No: access can be widened later; narrowing it after people rely on it is the hard direction                                                                                                                           | owner                 |

**D-8, per kind.**

| Browser data                                   | Recommendation                                                                                                                                                                                                                                                                                                           | If abandoned, the user loses                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saved projects                                 | **keep the lift.** On staging the server copy is authoritative and the lift has run. On production no lift has ever run (§2.3): the browser copy is the only copy. The one-time lift in `CachedSavedProjectsAdapter` must stay until production has been live on the new code long enough for returning users to sign in | on production, **everything**, if the lift were removed first                                                                                                                     |
| Editor workspace                               | **migrate** by lift                                                                                                                                                                                                                                                                                                      | unpushed edits to generated files                                                                                                                                                 |
| Brownfield draft                               | **migrate** by lift, keeping the 7-day expiry server-side                                                                                                                                                                                                                                                                | an import in progress                                                                                                                                                             |
| Governance threads                             | **migrate** by lift, after A1 scopes them to a project                                                                                                                                                                                                                                                                   | the Q&A history beside each wizard question. Before A1 they cannot be attributed to a project, so a lift assigns them to the project open at the time: say so in the release note |
| Chat history                                   | **abandon, after a one-time download.** The app offers the transcript as a file once; after that the key is removed. It is not lifted to the server                                                                                                                                                                      | nothing they were not offered first                                                                                                                                               |
| Canvas layout                                  | **migrate** by lift                                                                                                                                                                                                                                                                                                      | hand-arranged node positions                                                                                                                                                      |
| Generation results                             | **abandon**: nothing reads them, and they are rebuilt from the manifest. (The August plan would have kept the last 10 per project; this reverses it)                                                                                                                                                                     | nothing visible                                                                                                                                                                   |
| `hexagen-active-workspace` (localStorage)      | **abandon**: it is a second copy of a saved project's form state and manifest                                                                                                                                                                                                                                            | nothing, once its readers use the saved-projects port (A5)                                                                                                                        |
| `monaco-session-*` (localStorage)              | **abandon**: the adapter is wired but appears to have no caller; confirm in A5                                                                                                                                                                                                                                           | nothing, if confirmed                                                                                                                                                             |
| Wizard draft, legacy localStorage copies       | **abandon**, but not before the thaw. "One more release" means one more production release: a staging release reaches no production browser, so during the freeze the clock does not run                                                                                                                                 | nothing, unless a browser has not opened production since before those steps shipped                                                                                              |
| `byok:keys`, `hexagen:vault:encrypted-payload` | **delete on load**: no shipped code writes them, and ADR-0030 forbids server-side ciphertext                                                                                                                                                                                                                             | nothing                                                                                                                                                                           |

### 8.1 D-12: who owns a document

The key `(owner_id, kind, id)` goes into every row and every route, so the meaning of `owner_id` has to be right before A2. The question: is a document's owner always a user, or can it be an org or a team?

**What the code already does.** For projects, the owner is a tenant, and a tenant is a user or an org. An org's id goes in the same `saved_projects.owner_id` column as a user's id ("An org is just another owner", `apps/web/lib/platform/platform-db.ts:78-81`), and two triggers keep org ids and user ids from colliding. A team is never an owner, only someone a project is shared with (`platform-db.ts:151-154`). Access is worked out per request by `requireTenant` and `resolveProjectAccess` (`apps/web/lib/platform/require-owner.ts`), which return both the tenant and the acting user. Deleting an org is refused while it owns projects, and otherwise removes everything keyed by its id (`apps/web/lib/platform/orgs-store.ts:620-635`).

The documents in question are attached to a project but written by one person: that person's unpushed editor buffers, their governance threads, their canvas layout, their import draft.

| Option                          | Key                                                                                           | What it means                                                                    | Cost                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. A user only**              | `(user_id, kind, id)`                                                                         | Every document is personal, whatever tenant owns the project                     | The simplest. But a member's buffers for an org's project are filed under the member, not the org: deleting the org or removing the member does not find them, and the member keeps the org's file contents after losing access. Sharing later means a new key                                                     |
| **2. A tenant, as projects do** | `(owner_id, kind, id)`, where `owner_id` is a user or an org                                  | A document belongs to whoever owns the project                                   | Consistent with `saved_projects` and its routes, and org deletion reaches it. But on an org's project every member reads and writes the same buffers, threads and layout. That is shared editing by default, which D-14 decided against for now, and two members overwrite each other with only a 409 between them |
| **3. A tenant and an author**   | `(owner_id, user_id, kind, id)`: `owner_id` as in option 2, `user_id` the person who wrote it | The org owns the row; the author is the only one who reads and writes it for now | One more column in the key and in every query. For a personal tenant the two ids are equal. Org deletion and member removal can both find the rows. Widening access later (D-14) is a change to the guard, not to the key                                                                                          |

A team as owner is not offered: nothing in the product lets a team own anything, and adding that here would change the tenancy model through a storage table.

**Decided 2026-10-08: option 3**, which was also the recommendation. It is the only one that fits both decisions already made: the tenancy model (orgs own work) and D-14 (only the author sees a document for now). Option 1 is cheaper today and wrong the first time an org removes a member. Option 2 is right about ownership and forces a sharing decision that was just deferred.

**What option 3 commits to.** These were put to the owner with the option and chosen with it, unchanged. The first one destroys data, so the packet that ships it (A2) says so in its pull request's "Hard to undo" section and in its release note:

- When a member leaves or is removed from an org, their documents under that org are deleted, unpushed editor edits included. They are working copies of the org's project, and the person can no longer open it.
- A user's account export includes the documents they authored, in every tenant.
- The routes sit beside the project routes, under the tenant, and take the author from the session, never from the URL.

## 9. Test infrastructure

Tests run against in-memory or temp-file SQLite today, with no service container in any workflow.

- **Unit and route tests** keep their current speed by keeping an in-process backend. Two candidates: stay on SQLite for these (free, but it is then a second dialect to keep honest), or an in-process Postgres. D-6 defers the choice until B2 can measure both.
- **The contract suite (B2) and the race tests (B3)** need a real server. In CI that is a Postgres service container on the jobs that run them. For lanes it is the shared lane test server.
- **Lane registration.** Proposed role `hx_test` and database prefix `hx_`, with one kept database `hx_concurrency` for the B3 two-writer tests. The project's lane values change from `TEST_DB_ROLE=none` at B2, not before. These are host steps for the owner: register the role, open the lane container's egress to the test server, and install a Postgres client in the container for the verification step.
- **Harness shape**, taken from a sibling project that has already made this move: a fresh database per test file cloned from a migrated template, and a real server only for tests about two writers.
- Lanes run targeted suites only. GitHub CI remains the source of truth.

## 10. Risks

- **The contract change touches every authenticated route.** B1 is large and mechanical; a missed `await` on a guard is a security bug, not a crash. Mitigation: turn on the lint rule for floating promises in `apps/web` as part of B1, and land B1 alone.
- **NextAuth adapter.** Its methods return sync values today. Whether NextAuth writes `sessions` or `verification_tokens` under the JWT strategy was not verified; B1 must check before deciding what the ETL carries.
- **Staging rollback does not revert schema** (the staging README says so of SQLite; it is as true of Postgres). B4 keeps the SQLite files for that reason.
- **Lift on a shared browser.** The owner stamp stops cross-account uploads for projects; A3 must reuse it for every kind, or one user's editor buffers reach another's account.
- **Size.** Editor workspaces hold whole file trees as JSON. `owner_documents.payload` needs a size limit at the route, chosen in A2 from what real workspaces measure.
- **The freeze holds back fixes as well as features.** Production stays on 0.13.0, built on 2026-10-02, until the owner's database exists. Anything merged since, including security fixes, is on staging only. That is a consequence of the decision, stated here so it is a known one.
- **Browser data ages during the freeze.** The longer production browsers go without a lift, the more of them are cleared, replaced or lost. Nothing in this plan can shorten that; only the thaw can.

## 11. Not verified

- Production row counts were read on 2026-10-08 (§2.3) and must be read again at the thaw, since the production step depends on their still being zero.
- Whether the VPS has any host-level backup of the data volume outside this repository.
- How `project_owner_state.initialized` is set on every path (read in the client adapter, not traced through the route handlers).
- Whether any real browser still holds the legacy localStorage keys.
- Whether the canvas layout has a session id for users without a migrated wizard draft; if not, that store is inert today and its lift is a no-op.

## 12. Ready when

- On staging, a signed-in user sees the same projects, editor buffers, drafts and threads on a second browser.
- On staging, the application runs with `DATABASE_URL` set and no `platform.db` or `byok.db` open. After the thaw, production starts the same way on an empty database, and a returning user's browser projects are lifted on first sign-in.
- The contract suite passes on Postgres in CI, and the two-writer tests pass against a real server.
- A restore from backup has been performed on the Postgres database, with the date recorded.
- ADR-0071 is merged, and the August plans carry a note pointing here.
