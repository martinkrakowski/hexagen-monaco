# Production Postgres cutover

**Date:** 2026-10-11
**Status:** plan. Nothing in it is started. Merging this document changes nothing. Cutover execution remains unstarted and the owner's. This revision is read against `origin/main` at `f76f0751`: PR #872 is merged (`register` in `apps/web/instrumentation.ts:3-35` calls `enforceProductionDatabaseChoice` in `apps/web/lib/platform/production-db-choice.ts:38-56` before `startPlatformMigrations` in `apps/web/lib/platform/pg-startup.ts:21-77`), and commit `22c822c9` removed `deploy.yml` and `docker-compose.prod.yml` (`.github/workflows/build-image.yml:24`).
**Read against:** this revision, `origin/main` at `f76f0751`; earlier reads: `origin/main` at `61277698`, and pull request #872 (`origin/fix/production-database-choice`, head `10defd56`, merge base `884d1c4a`).
**Review:** one read-only pre-merge pass (Fable, 2026-10-11) on four questions: the SQLite data, TLS and the CA, the rollback, and the order with #872. Verdict "merge after fixes"; its six findings are applied in this text (the older-ref deploy, the both-variables case with an empty URL, signed-in browsers, re-reading the row counts before the deploy, the previous image after a failed deploy, and F3 stated as read). It did not check F1, F2, F8, most of F11, or anything about Aiven itself.
**How it was written:** a read-only pass. No database was contacted, no command was run against any host, no password was seen or asked for. Every secret below is the placeholder `<PASSWORD>`.
**Sources:** a claim with a path and line number was read in code at the commit above. Driver claims were read in the installed packages `pg` 8.23.1, `pg-connection-string` 2.14.1 and `pg-pool` 3.14.0. The checkout this plan was read in has no `node_modules`, so those files were read in a second checkout of this repository whose `yarn.lock` resolves the same versions (`pg` at `yarn.lock:10070-10072`, `pg-connection-string` at `10027-10029`, `pg-pool` at `10041-10043`). A claim marked **UNVERIFIED** was not read in code. "owner, 2026-10-11" marks a fact the owner gave that is not in the repository.

**The database (owner, 2026-10-11):** Aiven managed Postgres, host `hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com`, port 12194, TLS required, PostgreSQL 18.6. Database `hexagen`, empty, CONNECT revoked from PUBLIC. Application role `hgxadmin`: ordinary role, replication off; CONNECT, CREATE, TEMPORARY on the database; USAGE, CREATE on schema `public`. The admin role `avnadmin` stays with the owner. The owner ran every statement himself.

## Summary

**Recommendation.** Production starts on the empty Aiven database. There is no data to move and no tool to move it. The service applies its four migrations itself the first time it starts with `DATABASE_URL` set. Do it in this order:

1. PR #872 is already merged on `main`, and migration `0004` is merged and published by `build-image.yml`.
2. One platform-repo pull request (described in F6) removes `PLATFORM_DB=sqlite` from `apps/base/hexagen-web/app.yaml` and wires `DATABASE_URL`, the Aiven CA mount, and the TCP `12194` egress rule the pod needs (F11.9) in `apps/production/hexagen-web`. It stays reviewed and unmerged until Vault is populated.
3. The owner stores `DATABASE_URL` and rotated session secrets in Vault, forces the External Secrets sync, and verifies the cluster Secret's keys are present with non-zero lengths without printing values. This must happen **before** the platform-repo PR merges: as long as `PLATFORM_DB=sqlite` satisfies `checkProductionDatabaseChoice` with a blank `DATABASE_URL`, a deploy on SQLite in between lets users write rows that nothing can carry over (F7).
4. The owner merges the platform-repo PR, reconciles Flux, verifies with three checks (F9), and tests a restore before users are let in (F10).

**The three facts that decide the shape of this plan.**

- The connection string Aiven hands out (`?sslmode=require`) makes the service **fail to start** if Aiven's certificate is signed by its own CA (**UNVERIFIED**). This driver version treats `sslmode=require` as full verification against Node's public certificate authorities, and the code has no way to pass a CA except through the URL or a Node environment variable (F3).
- A failed cutover deploy is an **outage**, not a no-op. The single-pod `Recreate` strategy replaces the running pod before the new one has proved it can start (F11.1).
- Signed-in browsers stay signed in across the switch, because sessions are signed cookies and not database rows. A save made with such a cookie lands in Postgres under an owner id that has no `users` row (F7). The cutover therefore rotates `NEXTAUTH_SECRET` (and `AUTH_SECRET` if present) in Vault.
- After the cutover, **never point the cluster at an image built before the merge of #872 and migration `0004`**: such an image either refuses loudly against the migrated database or falls back to the SQLite file with a green rollout (F10).
- Because `PLATFORM_DB=sqlite` is enough to satisfy the production database choice when `DATABASE_URL` is blank, Vault and the `ExternalSecret` must populate a non-empty `DATABASE_URL` **before** the platform-repo PR removes `PLATFORM_DB=sqlite`; otherwise the service stays on SQLite with no error anywhere (F6).

**Open questions for the owner.**

- **Q1. Where the secret lives.** In Vault, synced by External Secrets into the cluster Secret (`deploy/.env.example:3-7`, `deploy/k8s/staging/README.md:1-5`), never in GitHub Actions or git. See F5.
- **Q2. How the CA reaches the container.** A platform-repo ConfigMap/Secret holding the CA PEM, mounted read-only into the pod (assumed here), or the certificate committed and copied into the image. A CA certificate holds no private key. See F3.
- **Q3. Does the password contain anything other than letters and digits?** If it does, it must be percent-encoded in the URL. No `.env` is generated anymore, so the quoting risk is gone; a letters-and-digits password still avoids the question entirely. See F4.
- **Q4. Collation of database `hexagen`.** The tests and the staging manifests use the `C` locale. If Aiven created the database with another locale, a few lists sort differently. Step 1 of "The owner's steps" reads it. See F1.
- **Q5. The connection limit.** One process holds up to 14 connections, 15 during start-up. Step 1 reads `max_connections`. See F11.2.
- **Q6. The restore test.** ADR-0071 asks for "a tested restore" from the production database (`.architecture/decisions/ADR-0071-postgres-cutover.md:51`). How Aiven backs up and restores is **UNVERIFIED** here. See F10.
- **Q7. Staging first?** No CI job and no deployment has yet run the production image against Postgres as far as the repository shows. Wiring staging to its own Postgres first would be the rehearsal. See F11.6.
- **Q8. Rotate `AUTH_SECRET` at the cutover?** Assumed yes: it signs every browser out, so no save can arrive with a cookie from before the switch. The alternative is to sign out by hand and accept the risk for any other browser. See F7.

## Findings

Findings are numbered locally, F1 to F11, one per question asked. This repository has no repository-wide finding sequence: `git grep -n "\bF[0-9]\+\b" -- docs` shows each document restarting at F1 (for example `docs/planning/staged-generation-baseline-findings.md:21`, `docs/planning/pr-agent-review-replication.md:64`).

### F1. Postgres versions in tests, CI and staging; version-sensitive SQL

**What runs where.**

- **Tests, locally and in CI:** an embedded server from the package `embedded-postgres` at `18.4.0-beta.17` (`apps/web/package.json:110`; `yarn.lock:5529-5531`), started by the vitest global setup (`apps/web/vitest.config.*` line 38; `apps/web/test-support/pg-global-setup.ts:113-139`). That this package version carries PostgreSQL 18.4 binaries is **UNVERIFIED**: no test asserts `server_version`.
- **`PLATFORM_TEST_PG_URL`:** if set, the tests use that server instead of the embedded one (`pg-global-setup.ts:96-97`). No workflow sets it.
- **CI:** the test job is `leg-test` in `.github/workflows/sync-integrity.yml` (job at line 324, `ubuntu-latest` at 326, Node 22.7 at 354, `yarn turbo run test` at 379). No workflow has a `services:` block or a Postgres image. CI therefore runs the embedded server.
- **Lane setup:** `.lane/` holds lane briefs and a `.gitignore`; no lane-specific Postgres configuration exists in the repository.
- **Staging manifests:** PostgreSQL 18.6 (`deploy/k8s/staging/postgres/cluster.yaml:17`), with locale `C` (lines 24-25). This is the same version as the Aiven service (owner, 2026-10-11). Whether that cluster is applied is **UNVERIFIED**.
- **Driver:** `pg` (node-postgres), declared `^8.12.3` (`apps/web/package.json:76`), resolved to 8.23.1 (`yarn.lock:10070-10072`). The package `postgres` is not used.
- **Runtime:** the production image runs Node 20 (`apps/web/Dockerfile:2`, `92`); the tests run on Node 22.7.

**Known to differ on 18:** nothing found. The migrations, the runner and the stores contain no construct I know to behave differently on 18, and the tests already run on an 18.x server. Anything about PostgreSQL 18 beyond what the code shows is **UNVERIFIED**.

**Where the migrations live.** Not in an `apps/web/migrations` directory (does not exist). They are `apps/web/lib/platform/pg-migrations/0001_initial.sql`, `0002_owner_document_revs_and_audit_detail.sql`, `0003_byok.sql`, `0004_decision_receipts.sql`, listed in `pg-migrations/index.ts:18-31` and applied by `runPgMigrations` (`apps/web/lib/platform/pg-migrate.ts:42-198`) via `runStartupMigrations` (`apps/web/lib/platform/pg-startup.ts:5-19`).

**Version-sensitive SQL features used.**

| Feature                                                                | Where                              | Note                                                               |
| ---------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `CREATE FUNCTION ... LANGUAGE sql`, `IMMUTABLE` / `STABLE`             | `0001_initial.sql:8-13`            | `hx_ts`, `hx_ms`, `hx_day`; used by every store                    |
| `extract(epoch from timestamptz)` cast to `bigint`                     | `0001:11`                          |                                                                    |
| plpgsql trigger functions, `CREATE OR REPLACE FUNCTION`                | `0001:339-347`, `353-361`          | needs the `plpgsql` language                                       |
| `CREATE TRIGGER ... EXECUTE FUNCTION`                                  | `0001:348-350`, `362-364`          | the `EXECUTE FUNCTION` spelling needs 11 or later (**UNVERIFIED**) |
| `GENERATED ALWAYS AS IDENTITY`                                         | `0001:278`, `301`                  | identity columns, not generated (computed) columns                 |
| `jsonb` columns                                                        | `0001:63`, `231`, `274`; `0002:7`  |                                                                    |
| Partial and partial unique indexes                                     | `0001:27-30`, `144-145`, `196-197` |                                                                    |
| `INSERT ... ON CONFLICT DO NOTHING`                                    | `0001:209-213`; `0002:25-29`       |                                                                    |
| Composite foreign key with `ON DELETE CASCADE`                         | `0001:235-236`                     |                                                                    |
| `CREATE SEQUENCE ... AS bigint`, `ALTER SEQUENCE ... OWNED BY`         | `0003_byok.sql:8`, `22`            |                                                                    |
| `CHECK (x = lower(x))`                                                 | `0001:23`, `135`                   | `lower()` depends on the database's character type                 |
| `pg_advisory_lock`, `SET lock_timeout`, a multi-statement simple query | `pg-migrate.ts:100-104`, `160`     | the runner                                                         |
| `BEGIN ISOLATION LEVEL SERIALIZABLE`                                   | `pg-db.ts:349`                     | every store transaction                                            |

**Not used anywhere in the migrations or stores:** `gen_random_uuid`, generated (computed) columns, `NULLS NOT DISTINCT`, an explicit `COLLATE` in Postgres SQL, extensions. Ids are `text` supplied by the application.

**Collation.** The test databases and the staging cluster are created with `LC_COLLATE 'C'` (`pg-global-setup.ts:119`, `234`; `cluster.yaml:24-25`). The stores sort by text columns in a few places (`teams-store.ts:148`, `161`; `orgs-store.ts:395`, `405`, `435`, `437`; `owner-documents-store.ts:213`; `repair-telemetry-store.ts:742`). Under another locale those lists come back in a different order. Nothing else depends on it. What locale Aiven gave the database is **UNVERIFIED** (Q4).

### F2. Extensions, privileges, schema

- **Extensions:** none. No migration contains `CREATE EXTENSION`, and no migration or store calls a function that needs one. `avnadmin` has nothing to create first. There is no statement to give.
- **Privileges `hgxadmin` needs:** CREATE on schema `public`, which it has (owner, 2026-10-11). That covers the tables, indexes, functions, triggers, the sequence, and the runner's own `CREATE TABLE IF NOT EXISTS schema_migrations` (`pg-migrate.ts:8-15`, `108`).
- **Privileges it does not need:** a search of `apps/web/lib` and `apps/web/app` found no `CREATE EXTENSION`, `CREATE SCHEMA`, `ALTER DATABASE`, `CREATE ROLE`, `session_replication_role`, `set_config`, temporary table, `LISTEN`/`NOTIFY` or `COPY`. The database-level CREATE and TEMPORARY grants are unused by the code.
- **Language use:** the functions are written in `sql` and `plpgsql`. That an ordinary role may create functions in both by default is **UNVERIFIED** (from memory: both are trusted languages usable by PUBLIC).
- **Session settings:** every connection sends `-c TimeZone=UTC -c idle_in_transaction_session_timeout=30000 -c DateStyle=ISO` as start-up options (`pg-db.ts:55-56`). That an ordinary role may set these three is **UNVERIFIED**.
- **Schema and search_path:** no object name in the migrations or the stores is schema-qualified, and the code never sets `search_path`. Everything lands in, and is read from, the first schema on the role's default search path. With the default (`"$user", public`, **UNVERIFIED**) that is `public`, provided no schema named `hgxadmin` exists. The code creates no schema of its own.
- **Ownership:** every object will be owned by `hgxadmin`, because `hgxadmin` creates it. Whether `avnadmin` can read those tables without a grant is **UNVERIFIED**.

### F3. TLS: what the driver does, and what the connection would be

**How the pool is made.** `createPgPool(connectionString, opts)` in `apps/web/lib/platform/pg-db.ts:30-68` builds `new Pool({ connectionString, types, options, max, connectionTimeoutMillis })` (lines 52-61). It passes no `ssl` object. Everything about TLS therefore comes from the URL. Three callers: the platform store (`createPgPlatformStore` / `getPlatformStore`, `store.ts:145-167`, default `max` 10), the BYOK store (`createPgByokStore` / `getByokStore`, `byok-store.ts:303-327`, `max: 4`), and the start-up migration (`runStartupMigrations`, `pg-startup.ts:5-19`, `max: 1`, 10-second connect timeout).

**How the URL is read** (`node_modules/pg-connection-string/index.js`, version 2.14.1):

- Any of `sslcert`, `sslkey`, `sslrootcert`, `sslmode` in the query sets `config.ssl = {}` (lines 77-79).
- `sslrootcert=<path>` reads that file from disk and sets `ssl.ca` (lines 98-100). The read happens inside the process, so the path is a path **inside the container**.
- Without `uselibpqcompat=true`, the modes `prefer`, `require`, `verify-ca` and `verify-full` all leave `ssl` as it is, which means full verification; the first three also print a one-time deprecation warning that says they "are treated as aliases for 'verify-full'" and will change meaning in `pg` 9 (lines 139-152, 219-230).
- `sslmode=no-verify` sets `rejectUnauthorized = false` (lines 153-156).
- With `uselibpqcompat=true`, `sslmode=require` sets `rejectUnauthorized = false` when no `sslrootcert` is given, and checks the chain but not the host name when one is given (lines 106-124).
- `pg` then applies the URL over the pool's own options (`node_modules/pg/lib/connection-parameters.js:59-61`), takes `ssl` from it (line 85), and opens TLS with the host name as the server name to check (`node_modules/pg/lib/connection.js:96-124`).

**What that means for this service.**

| URL ends with                                                                                  | Result as coded                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `?sslmode=require` (what a provider typically hands out)                                       | Encrypts and verifies chain and host name against Node's built-in public CAs. If the server certificate is signed by a private CA, the handshake is rejected and **the service fails to start**. |
| `?sslmode=verify-full&sslrootcert=/path/in/container/ca.pem`                                   | **verify-full** against that CA. Recommended.                                                                                                                                                    |
| `?sslmode=verify-full` plus `NODE_EXTRA_CA_CERTS=/path/in/container/ca.pem` in the environment | verify-full; the CA is added to Node's list.                                                                                                                                                     |
| `?sslmode=no-verify`, or `?uselibpqcompat=true&sslmode=require`                                | **Encrypts without verification.** Not recommended: nothing proves the server is Aiven's.                                                                                                        |
| no `sslmode` at all                                                                            | No TLS (`node_modules/pg/lib/defaults.js:50`). Aiven requires TLS (owner, 2026-10-11), so the connection is refused.                                                                             |

**Stated plainly:** as coded, with the URL in the form Aiven hands out and nothing else supplied, the connection is neither verify-full nor encrypt-only. It fails closed, on the assumption that Aiven's server certificate is signed by a project CA and not a public one. That assumption is **UNVERIFIED** (not in code; from memory of Aiven's documentation). The exact error text is **UNVERIFIED**; the line would start `[platform-migrate] start-up migration failed` (`pg-startup.ts:54`) and the process exits with status 1 (line 75).

**Ways to pass a CA.**

- An application environment variable for the CA: does not exist. `createPgPool` reads none.
- `sslrootcert=` in the URL: works (above).
- `NODE_EXTRA_CA_CERTS`: a Node feature, read when the process starts. Nothing in this repository sets or mentions it. That Node 20 honours it is **UNVERIFIED** here.
- `PGSSLROOTCERT`: not read by this driver. `pg` reads only `PGSSLMODE`, and only when the URL sets no `ssl` (`connection-parameters.js:25-38`, `85`).

**Mounting the CA file.**

- **Production (compose) — superseded.** `deploy/docker-compose.prod.yml` was removed by commit `22c822c9`; production now runs on k3s reconciled by Flux from the platform repository.
- **Production (k3s).** Mount the CA PEM read-only into the `hexagen-web` pod, readable by uid 1001 (`apps/web/Dockerfile:104`, `172`), from a platform-repo ConfigMap/Secret that matches `sslrootcert=` in the URL (or `NODE_EXTRA_CA_CERTS`). For example the file lands at `/etc/hexagen/aiven-ca.pem` inside the pod and the URL reads `sslrootcert=/etc/hexagen/aiven-ca.pem`. If the mount is missing or unreadable, the read fails and the service exits at start.
- **Staging (k3s) — superseded.** `deploy/k8s/staging/` is retired (2026-10-23): staging now runs from the platform repository with its settings from Vault through External Secrets (`deploy/k8s/staging/README.md:1-5`). The Aiven database is production-only.
- **Alternative (Q2).** Commit the CA certificate and copy it into the image. No ConfigMap/Secret to forget; the price is a rebuild when Aiven rotates the CA.

### F4. What `DATABASE_URL` looks like

The driver accepts a URL (`pg-connection-string/index.js:25-32`). A libpq keyword string (`host=... port=...`) is not accepted. The user name and password are percent-decoded (lines 44-45), so any character in the password outside letters, digits, `-`, `.`, `_`, `~` must be percent-encoded (`@` as `%40`, `:` as `%3A`, `/` as `%2F`, `%` as `%25`, and so on).

Recommended:

```
postgres://hgxadmin:<PASSWORD>@hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com:12194/hexagen?sslmode=verify-full&sslrootcert=/etc/hexagen/aiven-ca.pem
```

Also accepted, when the CA is given through `NODE_EXTRA_CA_CERTS` instead:

```
postgres://hgxadmin:<PASSWORD>@hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com:12194/hexagen?sslmode=verify-full
```

Notes.

- `postgresql://` works the same; the parser does not check the scheme.
- Use the direct service port, 12194. Do not use a connection-pooler address: the service sends start-up options on every connection (`pg-db.ts:55-56`) and holds a session-level advisory lock while migrating (`pg-migrate.ts:102`). That a pooler in transaction mode breaks both is **UNVERIFIED**.
- The code trims the value (`store.ts:161`; `byok-store.ts:321`; `pg-startup.ts:29`), so a trailing newline is harmless.
- No `.env` is generated anymore. The deploy workflow was removed by commit `22c822c9`; the value is written in Vault, synced by External Secrets into the cluster Secret, and read from the environment by the container. A letters-and-digits password avoids percent-encoding (Q3).

### F5. Where the secret lives

**Production: the cluster Secret, synced from Vault.**

- Existing pattern: runtime settings come from the cluster's Secret and Deployment env in the platform repository (`martinkrakowski/platform`, `apps/production/hexagen-web`), not from this repository. `deploy/.env.example:3-7` documents the variables the web container reads and says the file is never shipped.
- The Secret is populated by External Secrets from Vault. `DATABASE_URL` is in none of these places today: the platform-repo manifest sets `PLATFORM_DB=sqlite` (`apps/base/hexagen-web/app.yaml:45`) and no `DATABASE_URL`.
- **How the owner enters it (assumed, Q1):** write the value in Vault under the path External Secrets reads, wait for the sync, and verify the Secret's keys are present with non-zero lengths without printing values — the same read-only shape as the retired staging check (`deploy/k8s/staging/README.md:19-21`). Never in GitHub Actions, never in a manifest, never in git.

**Staging: retired.** `deploy/k8s/staging/` deployed to the midnight cluster, decommissioned on 2026-10-19; staging now runs from the platform repository (`apps/staging/hexagen-web`) with its settings from Vault through External Secrets (`deploy/k8s/staging/README.md:1-5`).

**Exposure to know about.** Anyone who can read Secrets in the production namespace can read the URL with its password. Keep that namespace's access tight, and never print Secret values in logs or chat.

### F6. Replacing `PLATFORM_DB=sqlite` with `DATABASE_URL`, per file, and the order

**What #872 does (already merged).** With `NODE_ENV=production` the service checks the choice at start, before the migrations (`register()` in `apps/web/instrumentation.ts:3-35` calls `enforceProductionDatabaseChoice` in `apps/web/lib/platform/production-db-choice.ts:38-56` before `startPlatformMigrations` in `apps/web/lib/platform/pg-startup.ts:21-77`). Neither variable set: it logs `[platform-db] refusing to start ...` and exits 1. Both set: Postgres is used and it logs `[platform-db] PLATFORM_DB=sqlite is ignored because DATABASE_URL is set; Postgres is used. Remove one of the two.` The image always runs with `NODE_ENV=production` (`apps/web/Dockerfile:175`).

**Per file.**

| File                                           | What the cutover does                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/build-image.yml`            | Publishes the image from `main`. Only the three public build args pass (lines 20-30). No runtime secret touches it; the `DATABASE_URL` is never a build arg.                                                                                                                                                                   |
| `deploy/.env.example`                          | Unshipped documentation of the variables the web container reads (lines 3-7, 24-28). Update it to document `DATABASE_URL` and the CA mount.                                                                                                                                                                                    |
| `.github/workflows/lint.yml`                   | `PLATFORM_DB: sqlite` for `standalone-smoke` (line 374) and `-e PLATFORM_DB=sqlite` on `container-smoke` (line 502): **stay as they are.** Neither job has a database. They test packaging and the scan, not the store.                                                                                                        |
| platform repo `apps/base/hexagen-web/app.yaml` | Sets `PLATFORM_DB=sqlite` (line 45). The cutover PR removes it and wires `DATABASE_URL` (from the Secret) and the CA mount. The TCP `12194` egress rule is a NetworkPolicy change, not a Deployment change, and does not belong in the shared base, which staging also uses (`apps/staging/hexagen-web/kustomization.yaml:8`). |
| platform repo `apps/production/hexagen-web`    | The production overlay that Flux reconciles; the cutover PR lands here, and adds the TCP `12194` egress rule for the `web` pod there (the way the staging overlay adds `otlp-egress.yaml`) (F11.9).                                                                                                                            |

The compose-era rows (`deploy.yml`, `docker-compose.prod.yml`) are superseded: commit `22c822c9` removed both files.

**Order.**

- **Vault before Flux.** The check is live on `main`. Because `PLATFORM_DB=sqlite` satisfies `checkProductionDatabaseChoice` on its own (`production-db-choice.ts:25-30`) whenever `DATABASE_URL` is blank, Vault and the `ExternalSecret` must populate a non-empty `DATABASE_URL` **before** the platform-repo PR merges. Otherwise the site keeps running on SQLite with no error anywhere, and the first signed-in user writes rows there (F7).
- **Both variables set** (for example the manifest line kept by mistake). With a non-empty URL, Postgres is used and the warning above is logged at every start. With an EMPTY or misnamed `DATABASE_URL` secret it is not harmless: `PLATFORM_DB=sqlite` satisfies the check on its own (`production-db-choice.ts:25-30`), no migration runs, the SQLite file is opened, and the rollout is green with no warning. Removing `PLATFORM_DB=sqlite` is therefore part of the cutover, not tidying.
- **Do not ship the platform-repo PR before Vault has the value.** The first signed-in user would write rows to SQLite; there is no tool to carry them (F7).

### F7. Today's SQLite data: is there a copy path?

- **A copy tool does not exist.** No SQLite-to-Postgres script is in the repository. `scripts/` has none; `docs/runbooks` does not exist; `staging-postgres-dumps` is not mentioned anywhere in this repository. The only mention of such a script is a plan that was never built: `scripts/etl-sqlite-to-postgres.mjs` in `docs/planning/2026-08-23-gcp-migration-plan.md:150`. The later plan dropped it (`docs/planning/2026-10-07_indexeddb-to-postgres-migration-plan.md:35`) and records "No proven data-migration tool exists" under what the owner accepted.
- **Production starts empty.** That is the decided path: "Production has no rows to carry. Its step is to run the migrations against the empty database on the first deploy after the freeze" (ADR-0071 line 84).
- **Is there a production deployment with real data today?** The repository says no, in documents and not in code: the production files were read on 2026-10-08 and the user, account, session, project, run, entitlement, BYOK and quota tables had 0 rows; the only rows were 3 seeded `model_prices` (plan §2.3, line 131). The state today is **UNVERIFIED**. The ADR requires reading the counts again at the cutover (line 84; plan line 370). Step 2 of "The owner's steps" does that.
- **The window between the last count and the switch.** The running container accepts saves until the deploy replaces it, and the code has no way to refuse writes meanwhile. A save in that window lands in SQLite and is not carried. The plan does not close the window; it detects it: the counts are read again right before the deploy (owner's step 6) and once more after it (step 8), from the file that stays on the volume.
- **If a table is no longer empty,** stop. A tool would have to be written first. The tables that hold data that matters: `users`, `accounts`, `sessions`, `verification_tokens`; `saved_projects`, `project_owner_state`, `owner_documents`, `owner_document_revs`; `orgs`, `org_members`, `org_invites`, `teams`, `team_members`, `project_shares`; `entitlements`; `audit_log`; `run_events`, `scan_records`, `repair_runs`, `repair_attempts`; and from `byok.db`, `byok_key_metadata` and `byok_revocations`. After a load of BYOK rows the sequence must be advanced (`0003_byok.sql:4-7` gives the statement).
- **Signed-in browsers at the switch.** Sessions are signed cookies (`apps/web/app/lib/auth.ts:74`, `session: { strategy: "jwt" }`); the `sessions` table is not used for them. A request takes the owner id from the cookie without a database lookup (`apps/web/lib/platform/require-owner.ts:46-47`), and `saved_projects.owner_id` has no foreign key (`pg-migrations/0001_initial.sql:59-69`). A browser that signed in before the cutover therefore stays signed in, and its saves land in Postgres under an id that has no `users` row; the next real sign-in creates a new user with a fresh id (`auth-store.ts:168-169`) and those rows are unreachable. With 0 users on production this concerns the owner's own browser, but it costs nothing to close: rotate `NEXTAUTH_SECRET` (and `AUTH_SECRET` if present, `deploy/.env.example:15-18`, `deploy/k8s/staging/README.md:51-53`) in Vault before the cutover, which signs every browser out. At the least, sign out before the deploy.
- **What does not move in any case:** `quota.db` stays a SQLite file (ADR-0071 line 73), and scan artifacts stay files under `/data/scan-artifacts` (`resolveScanArtifactsDir`, `apps/web/lib/platform/platform-db.ts:802-808`). The `/data` volume stays mounted in the pod and the SQLite files stay untouched on it.
- **Work that exists only in browsers.** Projects made before the account gate were never copied to the server on production (plan §2.3). After the cutover they are copied into Postgres when their owner first signs in. That mechanism was not read for this plan: **UNVERIFIED**.

### F8. The migration run

- **Who and where:** the service itself, inside the container, at start. `register()` calls `startPlatformMigrations(process.env)` when `DATABASE_URL` is non-empty (`apps/web/instrumentation.ts:24-28`). The GitHub runner never connects to the database. No agent and no person runs anything.
- **A CLI or script:** does not exist. No `migrate` script is in `package.json` or `apps/web/package.json`. The only "command" is starting the service.
- **What it prints.** First start on the empty database: `[platform-migrate] applied versions: [1, 2, 3, 4]`. Later starts: `[platform-migrate] up to date`. On failure: `[platform-migrate] start-up migration failed; this build knows versions 1..4; code=<code>; <message>`, with the URL replaced by `[DATABASE_URL]` in the text, then exit status 1 (`pg-startup.ts:41-45`, `54`, `74-75`).
- **The lock.** One connection takes the session advisory lock `7302026100801` and waits at most 60 seconds for it (`pg-migrate.ts:6`, `99-105`; `pg-startup.ts:13-15`).
- **Two replicas.** The second waits for the lock, then finds everything applied and logs "up to date". If the first needs more than 60 seconds, the second fails with code `55P03`, exits 1 and is restarted. Production and staging both run one instance (platform repository `apps/base/hexagen-web/app.yaml:19`; `deploy/k8s/staging/deployment.yaml:8-12`), and ADR-0071 line 91 keeps it at one.
- **Empty database.** The runner creates `schema_migrations` (`pg-migrate.ts:8-15`, `108`), then applies 1, 2, 3 and 4 in order, each in its own transaction together with its bookkeeping row (lines 155-165). After it: 26 tables in `public` (25 from the migrations plus `schema_migrations`), 3 rows in `model_prices` (`0001:209-213`), 4 rows in `schema_migrations`.
- **Half-migrated database.** A migration that fails is rolled back whole (lines 166-173); the ones before it stay applied; the next start continues from there. All four current migrations are transactional (`pg-migrations/index.ts:18-31`).
- **What the runner refuses, with exit 1:**
  - a version in the database that this build does not know: "this build is older than the database" (lines 121-128). This is what an older image would hit after a newer one has migrated.
  - a gap in the applied versions (lines 130-138).
  - an applied migration whose file text has changed since: "Migration checksum mismatch" (lines 144-151).
  - tables that exist without a `schema_migrations` table (someone ran the SQL by hand): migration 1 fails with "already exists". The database must be emptied first.

### F9. Verification after the switch

- **A health endpoint that reports the database:** does not exist. There is no `/api/health`. The probe everywhere is an `httpGet` on `/api/auth/providers` with no custom success codes, so Kubernetes accepts 200–399 only (platform repository `apps/base/hexagen-web/app.yaml:50-56`; `deploy/k8s/staging/deployment.yaml:80-99` is the same shape); it does not prove the database is in use.
- **A log line that names the store:** does not exist as such. The evidence is the `[platform-migrate]` line, which is printed only when `DATABASE_URL` is set (`instrumentation.ts:24`). No `[platform-migrate]` line in the log means the service is on SQLite.
- **Three checks, all in "The owner's steps":**
  1. `kubectl logs` on the `web` pod (`kubectl -n hexagen-web logs deploy/web`; the pods are named `web-…`) shows `[platform-migrate] applied versions: [1, 2, 3, 4]` and no `[platform-db]` warning.
  2. As `hgxadmin`: `select version, name, applied_at from schema_migrations order by version;` returns `1 initial`, `2 owner_document_revs_and_audit_detail`, `3 byok`, `4 decision_receipts`.
  3. After signing in and saving a project: `select count(*) from users;` and `select count(*) from saved_projects;` are above zero, and `/data/platform.db` on the volume has not changed its modification time. The first sign-in of an unknown account calls `createUser` (`apps/web/lib/platform/auth-store.ts:167-169`). If `users` is 0 after a save, the save was made with a cookie from before the cutover (F7): sign out, sign in, save again.

### F10. Rollback at each step, and the one-way doors

Per-step rollbacks are in the step table. The general picture:

- **Until the first user writes to Postgres, everything is reversible.** The SQLite files are not opened while `DATABASE_URL` is set and stay on the `/data` volume. Going back means: remove `DATABASE_URL` from the Vault secret, force the ExternalSecret sync so the cluster Secret `hexagen-web-env` drops the key, **then** revert the platform-repo PR and reconcile Flux — in that order. The revert alone does not return the process to SQLite: `envFrom: [{secretRef: {name: hexagen-web-env}}]` is already at `app.yaml:37` before the cutover PR, and `env-secret.yaml:1-14` copies every key of Vault secret `hexagen-web-env` into that Secret (`refreshInterval: 1h`), so reverting the PR leaves `DATABASE_URL` in the environment, where `PLATFORM_DB=sqlite` does not mask it (`production-db-choice.ts:25-27` uses Postgres whenever the URL is set) — and with the CA mount gone, `sslrootcert=/etc/hexagen/aiven-ca.pem` points at a missing file, the pod exits at start, and `Recreate` keeps the site down. Removing the key first means the pod that runs after the revert starts with `PLATFORM_DB=sqlite` and no `DATABASE_URL` and opens the SQLite file.
- **Fast way back:** as above — Vault key removed and the ExternalSecret force-synced first, then the revert, then `flux reconcile kustomization apps --with-source --namespace flux-system`. Verify the Secret before restarting anything: `kubectl -n hexagen-web get secret hexagen-web-env -o jsonpath='{.data.DATABASE_URL}' | wc -c` must print `0` (never print the value: while the key is still present the raw jsonpath prints the base64 URL, password included).
- **Slow way back (app code):** production does not run a tag. `apps/production/hexagen-web/kustomization.yaml:8-9` pins `ghcr.io/martinkrakowski/hexagen-web` by digest, and `.github/workflows/build-image.yml:163-165` records that digest for a platform promotion pull request. So app-code rollback after door 1 is a **new** digest — built from the reverted application commits on `main`, with `PLATFORM_DB` left unset — promoted by a platform-repo PR that updates the digest; there is no tag to re-pin.
- **The previous image.** The `Recreate` strategy terminates the old pod before the new one starts (platform repository `apps/base/hexagen-web/app.yaml:19`; ADR-0071:91 keeps it single-container). After a SUCCESSFUL rollout the old pod is gone, but the digest the production overlay pinned before the cutover is still in the registry (`apps/production/hexagen-web/kustomization.yaml:8-9` pins by digest). After a FAILED rollout (the new pod exits at start) the site is down until the manifest is reverted and Flux reconciles.
- **Never point the cluster at an image built before the merge of #872 and migration `0004`.** A build before `0004` knows versions 1..3 and refuses loudly against the migrated database — "this build is older than the database" (`pg-migrate.ts:121-128`). A build before #872 has no check at all, opens `/data/platform.db` (`store.ts:161`) when `PLATFORM_DB=sqlite` is still set, and rolls out green. To ship older application code, revert the application commits on `main`, publish a new image, and promote its digest through a platform-repo PR; never promote the old digest.

**One-way doors.**

1. **The first user write to Postgres.** After it, going back to the SQLite file loses every write since the switch. A Postgres-to-SQLite export does not exist, and the owner decided not to build one (ADR-0071 lines 83, 97; plan row D-13). From then on the only way back is a restore of the Postgres database. That is why the restore test (Q6) belongs before users are let in.
2. **The first applied migration.** The text of `0001` to `0004` is then fixed by checksum (`pg-migrate.ts:144-151`) and the column types are the stored format (ADR-0071 lines 58, 64). Undoing it while the database is still empty means emptying the database, which only the owner can do.
3. **The host.** Moving a live database to another host later is a second cutover (plan row D-3, line 292).

### F11. Other things in the code that would surprise

1. **A failed cutover deploy takes the site down.** The single-pod `Recreate` strategy replaces the running pod before the new one has proved it can start (platform repository `apps/base/hexagen-web/app.yaml:19`; ADR-0071:91 keeps it single-container). If the new pod exits at start, the rollout fails and the site is down until the manifest is reverted and Flux reconciles (F10). Hence the pre-checks in the owner's steps and the Vault-before-Flux order (F6).
2. **Pool size.** Platform pool 10 (`pg-db.ts:57`), BYOK pool 4 (`byok-store.ts:305`), one more connection during start-up (`pg-startup.ts:8-11`): up to 14 in steady state, 15 at start. The sizes are fixed in code; an environment variable for them does not exist. Aiven's limit for this plan is **UNVERIFIED** (Q5).
3. **Timeouts.**
   - `idle_in_transaction_session_timeout` is 30 seconds (`pg-db.ts:56`).
   - A statement timeout does not exist.
   - The runtime pools have no connect timeout (`pg-db.ts:58-60` sets one only when asked; only the start-up pool asks). If the database becomes unreachable, a request waits (`node_modules/pg-pool/index.js:206`) instead of failing quickly.
   - Idle connections close after 10 seconds (`pg-pool/index.js:98-99`). After a quiet moment the next request pays for a new TCP, TLS and login handshake to Aiven. The added latency is **UNVERIFIED**.
4. **Every transaction is SERIALIZABLE** with up to five attempts (`pg-db.ts:12`, `349`, `376-380`). Nothing to do; it explains `40001` retries if they appear in Aiven's logs.
5. **Build time against run time.** `DATABASE_URL` is read from `process.env` when the server runs (`instrumentation.ts:24`; `store.ts:161`; `byok-store.ts:321`). The build inlines only `APP_VERSION` and `COMMIT_HASH` (`apps/web/next.config.mjs:249-252`), and the Dockerfile takes only the three `NEXT_PUBLIC_*` build arguments (`apps/web/Dockerfile:62-69`). The URL is not baked into the image and never reaches the build; the same image serves SQLite and Postgres.
6. **The container smoke test does not cover Postgres.** `container-smoke` boots the production image on SQLite (`lint.yml:502`). The Postgres tests run from source on Node 22.7, not in the image on Node 20. Whether `pg` and the four `.sql` files (bundled through the rule at `next.config.mjs:273-277`) work inside the built image has, as far as the repository shows, never been exercised: staging is retired (`deploy/k8s/staging/README.md:1-5`). The first run of the image against Postgres may be production (Q7).
7. **The sslmode warning.** With `sslmode=require` the driver prints a security warning once per process (`pg-connection-string/index.js:219-230`). The recommended `sslmode=verify-full` prints none.
8. **IPv6.** The driver passes the host name to Node and does not pick an address family. Whether the Aiven name has an IPv6 address, and whether the pod can reach it, is **UNVERIFIED**.
9. **Egress: the pod cannot reach Aiven's port today.** The only network that connects is the cluster's; the GitHub runner does not. But the egress the pod has is not enough: `apps/base/hexagen-web/networkpolicies.yaml:6-9` is default-deny for every pod in namespace `hexagen-web`, and the `web-egress` policy (`:30-51`) allows only DNS and TCP `443` to public IPv4. No rule opens TCP `12194`, and `apps/production/hexagen-web/kustomization.yaml` adds none; a throwaway pod in the namespace has no egress at all. The `web` pod therefore cannot open `hexagen-…aivencloud.com:12194` today, and with `strategy: Recreate` (`app.yaml:19`) a cutover deploy whose connections all fail makes the new pod exit at start and the site stays down (F11.1). The platform-repo PR must add an egress rule for TCP `12194` from the `web` pod to the Aiven service's addresses in the same change that wires `DATABASE_URL`; without it the cutover is an outage. Independently, if the Aiven service restricts source addresses (**UNVERIFIED**), the cluster's egress address(es) must be allowed on Aiven's side.
10. **The error log hides the URL only as a whole string** (`pg-startup.ts:52`). A driver message that quotes part of it would not be caught. The messages read in the driver quote the host, not the password.

## Step table

| #   | Step                                                                                                                           | Who   | Command                                                                        | Expected output                                                        | Rollback                                                                                               | One-way?                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------- |
| 1   | Confirm #872 and migration `0004` are merged and published by `build-image.yml`; the platform-repo PR is reviewed and unmerged | owner | none                                                                           | CI green; image published for the merge                                | n/a                                                                                                    | no                               |
| 2   | Read the production SQLite row counts and file times                                                                           | owner | `kubectl exec` on `deploy/web` in `hexagen-web` (owner's step 2)               | 0 rows everywhere except 3 in `model_prices`                           | none needed; if not zero, stop                                                                         | no                               |
| 3   | Read-only checks on the database                                                                                               | owner | `psql` as `hgxadmin` (owner's step 1)                                          | 18.6; `public` creatable; no tables                                    | none needed                                                                                            | no                               |
| 4   | Validate the CA and the TLS handshake from your machine                                                                        | owner | owner's step 3                                                                 | certificate parses; `verify-full` handshake succeeds                   | none needed                                                                                            | no                               |
| 5   | Set `DATABASE_URL` and rotated session secrets in Vault                                                                        | owner | Vault + External Secrets sync (owner's step 4)                                 | keys present, non-zero lengths                                         | rotate/delete in Vault                                                                                 | no                               |
| 6   | Merge the platform-repo PR                                                                                                     | owner | merge in the platform repository                                               | nothing deploys until Flux reconciles                                  | remove the Vault key, force-sync the ExternalSecret, revert the merge, reconcile Flux (F10)            | no                               |
| 7   | Reconcile Flux and verify the migration                                                                                        | owner | `flux reconcile`; `kubectl rollout status`; `kubectl logs` (owner's step 6) | log shows `applied versions: [1, 2, 3, 4]`; no `[platform-db]` warning | remove the Vault key, force-sync the ExternalSecret, revert the platform-repo PR, reconcile Flux (F10) | the migration is applied: door 2 |
| 8   | Check the database                                                                                                             | owner | `psql` as `hgxadmin` (owner's step 7)                                          | 4 migration rows; 3 `model_prices` rows; 26 `public` tables            | as step 7                                                                                              | no                               |
| 9   | Verify the SQLite files stayed untouched                                                                                       | owner | `kubectl exec` `stat`; save a project (owner's steps 8-9)                      | own account present; `/data/*.db` times unchanged                      | as step 7                                                                                              | no                               |
| 10  | Test a restore, record the date                                                                                                | owner | Aiven's own tooling, **UNVERIFIED**                                            | a restored copy answers the `schema_migrations` query of step 8        | none needed                                                                                            | no                               |
| 11  | Let users in                                                                                                                   | owner | none                                                                           | users sign in and save                                                 | a Postgres restore only                                                                                | **yes: door 1**                  |

## The owner's steps

One at a time. Do not start a step before the check of the one before it has passed. Wherever `<PASSWORD>` appears, you type it yourself; it goes into no file in the repository and into no chat.

**Before you start.** #872 and migration `0004` are merged and published by `build-image.yml`. The platform-repo pull request (F6) is reviewed and not yet merged. Production is reconciled by Flux from `martinkrakowski/platform` on the OCI k3s cluster; this repository only publishes the image.

**Step 1. Look at the database as `hgxadmin`. Read-only.**

Download the service's CA certificate from the Aiven console to your machine (where to find it is **UNVERIFIED**), then:

```sh
psql "host=hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com port=12194 dbname=hexagen user=hgxadmin sslmode=verify-full sslrootcert=/path/to/aiven-ca.pem"
```

`psql` asks for the password. Then:

```sql
show server_version;
show max_connections;
show search_path;
select datcollate, datctype from pg_database where datname = current_database();
select has_schema_privilege('public', 'CREATE') as can_create;
select count(*) as tables from information_schema.tables where table_schema = 'public';
```

Look for: version 18.6; `can_create` is `t`; `tables` is 0; `search_path` contains `public`. Write down `max_connections` (the service needs 15) and the two locale values (`C` matches the tests; anything else only changes the order of a few lists). If `psql` rejects the certificate with `verify-full`, stop: the application would fail the same way.

**Step 2. Read the production SQLite row counts. Read-only, on the cluster.**

```sh
kubectl exec -it deploy/web -n hexagen-web -- node -e "const D=require('node:module').createRequire('/app/apps/web/')('better-sqlite3');for(const f of ['platform','byok','quota']){try{const d=new D('/data/'+f+'.db',{readonly:true,fileMustExist:true});for(const t of d.prepare(\"select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name\").all())console.log(f,t.name,d.prepare('select count(*) n from \"'+t.name+'\"').get().n);d.close()}catch(e){console.log(f,'-',e.message)}}"
kubectl exec -it deploy/web -n hexagen-web -- sh -c 'stat -c "%y %n" /data/*.db'
```

The row-count command is adapted from the `tableCounts` helper in `deploy/k8s/staging/sqlite-backup/sqlite-backup.cjs:24`, `39-55` and has not been run: **UNVERIFIED**.

Look for: every table 0, except `model_prices` 3. A file reported as missing is fine. If any other table has rows, stop here: there is no tool to carry them (F7).

**Step 3. Validate the CA certificate and test the path from your machine.**

Use the CA PEM that the platform-repo ConfigMap/Secret will mount. On any machine with the file:

```sh
openssl x509 -in /path/to/aiven-ca.pem -noout -subject -enddate
openssl s_client -starttls postgres -connect hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com:12194 -CAfile /path/to/aiven-ca.pem -verify_hostname hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com -verify_return_error </dev/null
```

Run both commands from your own machine. Do not try to prove reachability from the cluster: every pod in namespace `hexagen-web` sits behind a default-deny NetworkPolicy (`apps/base/hexagen-web/networkpolicies.yaml:6-9`), and the `web-egress` policy (`:30-51`) allows only DNS and TCP `443` to public IPv4 — no rule opens TCP `12194`, so no pod, throwaway Job included, can reach Aiven at all today (F11.9). The platform-repo PR adds the `12194` egress rule; until it merges and Flux reconciles it, there is no pod-side proof of reachability, and the first end-to-end proof is the start-up migration log after step 6. That is why the egress rule must be part of the same PR: if the port is still blocked at that start, the new pod exits and the site is down under `Recreate` (F11.1).

Look for: a subject and an end date in the future from the first command; `Verify return code: 0 (ok)` from the second. They send no password. They prove that your machine reaches the service, that the CA is the right one, and that the host name matches. That this `openssl` supports `-starttls postgres` is **UNVERIFIED**. If the check does not return 0, stop.

**Step 4. Set the secrets in Vault.**

Write `DATABASE_URL` in Vault under the path the ExternalSecret reads, with your password in place of `<PASSWORD>`:

```
postgres://hgxadmin:<PASSWORD>@hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com:12194/hexagen?sslmode=verify-full&sslrootcert=/etc/hexagen/aiven-ca.pem
```

`/etc/hexagen/aiven-ca.pem` is the path inside the container and must equal the mount target in the platform-repo PR. If the password has characters other than letters and digits, percent-encode them (F4).

Rotate the session secret in Vault, so that every browser is signed out at the cutover (F7):

```sh
openssl rand -base64 48
```

Set the result as both `NEXTAUTH_SECRET` and `AUTH_SECRET` (the app reads `NEXTAUTH_SECRET ?? AUTH_SECRET`; `deploy/.env.example:15-18`, `deploy/k8s/staging/README.md:51-53`). The value is shown nowhere. (If you would rather not rotate it, see Q8; then signing out before step 6 matters.)

Force the External Secrets sync, then verify the cluster Secret's keys are present with non-zero lengths without printing values. Do not just wait: a Vault edit only shows up on the ExternalSecret's `refreshInterval`, which is 1 hour (`env-secret.yaml:1-14`). The namespace holds two ExternalSecrets (`hexagen-web-env`, `ghcr-pull`); the one that owns the Secret `hexagen-web-env` is itself named `hexagen-web-env` (`env-secret.yaml:5`, `target.name` at `:12`). Annotate it for a force sync, then check the keys:

```sh
kubectl get externalsecret -n hexagen-web
kubectl -n hexagen-web annotate externalsecret hexagen-web-env force-sync="$(date +%s)" --overwrite
kubectl -n hexagen-web get secret hexagen-web-env -o jsonpath='{.data.DATABASE_URL}' | wc -c
kubectl -n hexagen-web get secret hexagen-web-env -o jsonpath='{.data.NEXTAUTH_SECRET}' | wc -c
```

Look for: byte counts well above zero for both keys. Do not print the values.

From this moment the cluster Secret carries `DATABASE_URL` while the running pod still has no CA mount and `PLATFORM_DB=sqlite` in its manifest. That combination is unstable on restart: with `DATABASE_URL` set, `PLATFORM_DB=sqlite` does not mask it (`production-db-choice.ts:25-27`), and the URL's `sslrootcert=/etc/hexagen/aiven-ca.pem` points at a file that does not exist until the platform-repo PR's mount reconciles — so a pod start in this window crashes, and `Recreate` turns one crash into an outage (F11.1). Keep this window short and restart nothing between here and step 6.

**Step 5. Merge the platform-repo pull request.**

Look for: CI green on the platform repository. Nothing deploys until Flux reconciles the new manifest.

**Step 6. Reconcile Flux and verify the migration.**

First run the commands of step 2 again and look for the same result: the site was live while you did steps 3 to 5. If a table now has rows, stop. Then sign out of the application in your own browser.

```sh
flux reconcile kustomization apps --with-source --namespace flux-system
kubectl -n hexagen-web rollout status deployment/web
kubectl -n hexagen-web logs deploy/web 2>&1 | grep -E '\[platform-(migrate|db)\]'
```

The Flux object that reconciles `./apps/production` is the Kustomization `apps` in namespace `flux-system` (`clusters/production/layers.yaml:36-48`). `--with-source` forces a fresh Git fetch, so the reconcile cannot apply the last fetched artifact from before the merge (the source interval is 1 minute, `gotk-sync.yaml:9`, and a plain reconcile may still race it). The Deployment, its container and the Service are named `web` (`app.yaml:16`, `:35`, `:66`) in namespace `hexagen-web` (`namespace.yaml:6`); the pods are `web-…`.

Look for: the rollout completes. If it does not, the site may be down (F11.1): go to "If something goes wrong".

Look for: exactly `[platform-migrate] applied versions: [1, 2, 3, 4]`. No line at all means the service is on SQLite (the ExternalSecret did not populate `DATABASE_URL`). A `[platform-db] PLATFORM_DB=sqlite is ignored` line means the platform-repo manifest still carries the opt-in.

**Step 7. Check the database.**

With the `psql` command of step 1:

```sql
select version, name, applied_at from schema_migrations order by version;
select count(*) from model_prices;
select count(*) as tables from information_schema.tables where table_schema = 'public';
```

Look for: four rows (`initial`, `owner_document_revs_and_audit_detail`, `byok`, `decision_receipts`); 3; 26.

**Step 8. Note the SQLite file's time, then use the application.**

On the cluster:

```sh
kubectl exec -it deploy/web -n hexagen-web -- sh -c 'stat -c "%y %n" /data/*.db'
```

(That the image's `stat` accepts `-c` is **UNVERIFIED**; plain `ls -l /data` shows the time to the minute.) Write down the time of `platform.db` and `byok.db`. Sign in at `https://app.hexagen-monaco.cloud` with your own account and save one project. Run the same command again.

Look for: both times unchanged. `quota.db` may change; it stays on SQLite on purpose.

Then run the command of step 2 once more. The old pod kept serving until the rollout replaced it, so a save made between your count in step 6 and the switch went into the SQLite file, and nothing blocks writes in that window (a maintenance mode does not exist in the code). Look for: the same counts as in step 6. If a table gained rows, they are still in the file and are NOT in Postgres: stop before step 11 and decide what to do with them (F7: there is no tool to carry them).

**Step 9. Check your own rows.**

```sql
select count(*) from users;
select count(*) from saved_projects;
```

Look for: both above zero. If `users` is 0, your browser used a cookie from before the cutover: sign out, sign in, save again, and check that `NEXTAUTH_SECRET` was rotated (step 4). Up to here the only data in Postgres is your own, and going back loses nothing that matters.

**Step 10. Test a restore, before anyone else signs in.**

Restore the service's backup into a separate, throwaway service with Aiven's own tooling (how is **UNVERIFIED**), run the first query of step 7 against it, delete it, and record the date in this document. ADR-0071 line 51 asks for this.

Look for: the same four rows in the restored copy.

**Step 11. Let users in.**

This is the one-way door. From the first user's write, the way back is a Postgres restore and nothing else.

**If something goes wrong (before step 11).**

The revert of the platform-repo PR alone does **not** return the process to SQLite. `envFrom: [{secretRef: {name: hexagen-web-env}}]` predates the cutover PR (`app.yaml:37`), and `env-secret.yaml:1-14` copies every key of Vault secret `hexagen-web-env` into that Secret (`refreshInterval: 1h`); the revert removes neither. With `DATABASE_URL` still in the environment, `PLATFORM_DB=sqlite` does not mask it (`production-db-choice.ts:25-27`) and the process uses Postgres — but the reverted manifest no longer mounts the CA, so `sslrootcert=/etc/hexagen/aiven-ca.pem` fails to read, the pod exits at start, and `Recreate` leaves the site down (F11.1). Do it in this order:

1. In Vault, remove `DATABASE_URL` from the secret the ExternalSecret reads. (Leave the rotated `NEXTAUTH_SECRET` / `AUTH_SECRET` in place unless you also want the old sessions back.)
2. Force the ExternalSecret sync and wait until the cluster Secret has dropped the key:

```sh
kubectl get externalsecret -n hexagen-web            # the one that owns hexagen-web-env is hexagen-web-env (env-secret.yaml:5)
kubectl -n hexagen-web annotate externalsecret hexagen-web-env force-sync="$(date +%s)" --overwrite
kubectl -n hexagen-web get secret hexagen-web-env -o jsonpath='{.data.DATABASE_URL}' | wc -c   # expect 0
```

3. Only then revert the cutover PR in the platform repository and reconcile Flux:

```sh
# from the platform repository, after reverting the cutover PR:
flux reconcile kustomization apps --with-source --namespace flux-system
kubectl -n hexagen-web rollout status deployment/web
kubectl -n hexagen-web logs deploy/web 2>&1 | grep -E '\[platform-(migrate|db)\]'
```

`--with-source` forces a fresh Git fetch, so the reconcile applies the reverted manifest and not the last fetched artifact. The workload is Deployment `web` in namespace `hexagen-web`; the pods are `web-…`.

Look for: the pod healthy and no `[platform-migrate]` line; the service is back on the SQLite file. The Aiven database can stay as it is: a later attempt finds its migrations applied and logs `[platform-migrate] up to date`.

The same gap exists before the cutover PR merges: any pod start between the Secret receiving `DATABASE_URL` (step 4) and the PR's CA mount reconciling crashes for the same missing-`sslrootcert` reason. That is why step 4 ends with the forced sync verified and nothing is restarted until step 6.
