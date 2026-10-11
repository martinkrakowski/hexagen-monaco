# Production Postgres cutover

**Date:** 2026-10-11
**Status:** plan. Nothing in it is started. Merging this document changes nothing.
**Read against:** `origin/main` at `61277698`, and pull request #872 (`origin/fix/production-database-choice`, head `10defd56`, merge base `884d1c4a`).
**Review:** one read-only pre-merge pass (Fable, 2026-10-11) on four questions: the SQLite data, TLS and the CA, the rollback, and the order with #872. Verdict "merge after fixes"; its six findings are applied in this text (the older-ref deploy, the both-variables case with an empty URL, signed-in browsers, re-reading the row counts before the deploy, the previous image after a failed deploy, and F3 stated as read). It did not check F1, F2, F8, most of F11, or anything about Aiven itself.
**How it was written:** a read-only pass. No database was contacted, no command was run against any host, no password was seen or asked for. Every secret below is the placeholder `<PASSWORD>`.
**Sources:** a claim with a path and line number was read in code at the commit above. Driver claims were read in the installed packages `pg` 8.23.1, `pg-connection-string` 2.14.1 and `pg-pool` 3.14.0. The checkout this plan was read in has no `node_modules`, so those files were read in a second checkout of this repository whose `yarn.lock` resolves the same versions (`yarn.lock:9811-9813`, `9825-9827`, `9854-9856`). A claim marked **UNVERIFIED** was not read in code. "owner, 2026-10-11" marks a fact the owner gave that is not in the repository.

**The database (owner, 2026-10-11):** Aiven managed Postgres, host `hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com`, port 12194, TLS required, PostgreSQL 18.6. Database `hexagen`, empty, CONNECT revoked from PUBLIC. Application role `hgxadmin`: ordinary role, replication off; CONNECT, CREATE, TEMPORARY on the database; USAGE, CREATE on schema `public`. The admin role `avnadmin` stays with the owner. The owner ran every statement himself.

## Summary

**Recommendation.** Production starts on the empty Aiven database. There is no data to move and no tool to move it. The service applies its three migrations itself the first time it starts with `DATABASE_URL` set. Do it in this order:

1. Merge #872 first.
2. Merge one cutover pull request (described in F6) that passes `DATABASE_URL` through the deploy workflow, removes `PLATFORM_DB=sqlite` from the compose file, and mounts the Aiven CA certificate into the container.
3. The owner places the CA file on the VPS, sets the `DATABASE_URL` repository secret, and starts the Deploy workflow. This must be the first production deploy after the freeze: a deploy on SQLite in between lets users write rows that nothing can carry over (F7).
4. The owner verifies with three checks (F9) and tests a restore before users are let in (F10).

**The three facts that decide the shape of this plan.**

- The connection string Aiven hands out (`?sslmode=require`) makes the service **fail to start** if Aiven's certificate is signed by its own CA (**UNVERIFIED**). This driver version treats `sslmode=require` as full verification against Node's public certificate authorities, and the code has no way to pass a CA except through the URL or a Node environment variable (F3).
- A failed cutover deploy is an **outage**, not a no-op. The deploy replaces the running container before the new one has proved it can start (F11.1).
- Signed-in browsers stay signed in across the switch, because sessions are signed cookies and not database rows. A save made with such a cookie lands in Postgres under an owner id that has no `users` row (F7). The cutover deploy therefore rotates `AUTH_SECRET`.
- After the cutover, **never run the Deploy workflow from a ref older than the cutover merge**: that ref's workflow writes no `DATABASE_URL`, and the service goes back to the SQLite file with a green deploy (F10).
- Without #872, a missing or empty `DATABASE_URL` produces a **green deploy on SQLite** with no error anywhere (F6).

**Open questions for the owner.**

- **Q1. Where the secret lives.** A GitHub Actions repository secret named `DATABASE_URL` (the pattern every other production secret uses), or a second env file that exists only on the VPS. This plan assumes the repository secret. See F5.
- **Q2. How the CA reaches the container.** A file on the VPS mounted read-only (assumed here), or the certificate committed and copied into the image. A CA certificate holds no private key. See F3.
- **Q3. Does the password contain anything other than letters and digits?** If it does, it must be percent-encoded in the URL, and `$`, `"` and `\` are at risk in the generated `.env`. Simplest: a letters-and-digits password. See F4.
- **Q4. Collation of database `hexagen`.** The tests and the staging manifests use the `C` locale. If Aiven created the database with another locale, a few lists sort differently. Step 1 of "The owner's steps" reads it. See F1.
- **Q5. The connection limit.** One process holds up to 14 connections, 15 during start-up. Step 1 reads `max_connections`. See F11.2.
- **Q6. The restore test.** ADR-0071 asks for "a tested restore" from the production database (`.architecture/decisions/ADR-0071-postgres-cutover.md:51`). How Aiven backs up and restores is **UNVERIFIED** here. See F10.
- **Q7. Staging first?** No CI job and no deployment has yet run the production image against Postgres as far as the repository shows. Wiring staging to its own Postgres first would be the rehearsal. See F11.6.
- **Q8. Rotate `AUTH_SECRET` at the cutover?** Assumed yes: it signs every browser out, so no save can arrive with a cookie from before the switch. The alternative is to sign out by hand and accept the risk for any other browser. See F7.

## Findings

Findings are numbered locally, F1 to F11, one per question asked. This repository has no repository-wide finding sequence: `git grep -n "\bF[0-9]\+\b" -- docs` shows each document restarting at F1 (for example `docs/planning/staged-generation-baseline-findings.md:21`, `docs/planning/pr-agent-review-replication.md:64`).

### F1. Postgres versions in tests, CI and staging; version-sensitive SQL

**What runs where.**

- **Tests, locally and in CI:** an embedded server from the package `embedded-postgres` at `18.4.0-beta.17` (`apps/web/package.json:104`; `yarn.lock:5322-5324`), started by the vitest global setup (`apps/web/vitest.config.*` line 38; `apps/web/test-support/pg-global-setup.ts:113-139`). That this package version carries PostgreSQL 18.4 binaries is **UNVERIFIED**: no test asserts `server_version`.
- **`PLATFORM_TEST_PG_URL`:** if set, the tests use that server instead of the embedded one (`pg-global-setup.ts:96-97`). No workflow sets it.
- **CI:** the test job is `leg-test` in `.github/workflows/sync-integrity.yml` (job at line 324, `ubuntu-latest` at 326, Node 22.7 at 354, `yarn turbo run test` at 379). No workflow has a `services:` block or a Postgres image. CI therefore runs the embedded server.
- **Lane setup:** `.lane/` holds only a `.gitignore`. A lane-specific Postgres configuration does not exist in the repository.
- **Staging manifests:** PostgreSQL 18.6 (`deploy/k8s/staging/postgres/cluster.yaml:17`), with locale `C` (lines 24-25). This is the same version as the Aiven service (owner, 2026-10-11). Whether that cluster is applied is **UNVERIFIED**.
- **Driver:** `pg` (node-postgres), declared `^8.12.3` (`apps/web/package.json:70`), resolved to 8.23.1 (`yarn.lock:9854-9856`). The package `postgres` is not used.
- **Runtime:** the production image runs Node 20 (`apps/web/Dockerfile:2`, `54`); the tests run on Node 22.7.

**Known to differ on 18:** nothing found. The migrations, the runner and the stores contain no construct I know to behave differently on 18, and the tests already run on an 18.x server. Anything about PostgreSQL 18 beyond what the code shows is **UNVERIFIED**.

**Where the migrations live.** Not in an `apps/web/migrations` directory (does not exist). They are `apps/web/lib/platform/pg-migrations/0001_initial.sql`, `0002_owner_document_revs_and_audit_detail.sql`, `0003_byok.sql`, listed in `pg-migrations/index.ts:17-25` and run by `apps/web/lib/platform/pg-migrate.ts`.

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

**How the pool is made.** `createPgPool(connectionString, opts)` in `apps/web/lib/platform/pg-db.ts:30-68` builds `new Pool({ connectionString, types, options, max, connectionTimeoutMillis })` (lines 52-61). It passes no `ssl` object. Everything about TLS therefore comes from the URL. Three callers: the platform store (`store.ts:141`, default `max` 10), the BYOK store (`byok-store.ts:305`, `max: 4`), and the start-up migration (`pg-startup.ts:8-11`, `max: 1`, 10-second connect timeout).

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

- **Production (compose).** `deploy/docker-compose.prod.yml` mounts one volume, `quota-data:/data` (lines 34-35). A CA mount does not exist. The cutover pull request adds a read-only bind mount, for example `- ./aiven-ca.pem:/etc/hexagen/aiven-ca.pem:ro`; the path is relative to the compose file, which the deploy places at `/opt/hexagen-monaco/` (`.github/workflows/deploy.yml:52-55`, `66`). The owner puts the file there, readable by others (mode 644), because the container runs as uid 1001 (`apps/web/Dockerfile:62`, `130`). If the host file is missing, Docker is likely to create a directory in its place (**UNVERIFIED**); the read then fails and the service exits at start. The deploy only overwrites the two files it transfers (`deploy.yml:65-67`), so the CA file survives deploys.
- **Staging (k3s).** Staging is not to be pointed at the Aiven database. It has its own cluster and gets its URL from the operator's Secret (F5). Whether that URL asks for TLS is **UNVERIFIED**. If a Kubernetes deployment ever does use Aiven, the pattern is a ConfigMap holding the CA, mounted as a file, beside the existing `data` and `backups` mounts (`deploy/k8s/staging/deployment.yaml:56-67`, `107-114`). No such ConfigMap exists.
- **Alternative (Q2).** Commit the CA certificate and copy it into the image. No host file to forget; the price is a rebuild when Aiven rotates the CA.

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
- The code trims the value (`store.ts:150`; `byok-store.ts:321`; `pg-startup.ts:29`), so a trailing newline is harmless.
- The production `.env` is generated as `KEY="value"` lines (`deploy.yml:160-184`). How compose treats `$`, `"` and `\` inside a quoted value is **UNVERIFIED**. A letters-and-digits password avoids the question (Q3).

### F5. Where the secret lives

**Production: compose on a VPS.**

- Existing pattern: every runtime secret is a GitHub Actions repository secret. The Deploy workflow maps them into the job environment (`deploy.yml:76-126`), forwards them over SSH (line 131), and writes `/opt/hexagen-monaco/.env` with a heredoc (lines 160-184), mode 600 (lines 159, 185). The compose file loads it with `env_file: .env` (`docker-compose.prod.yml:21-22`). `deploy/.env.example:1-12` documents this and says the file is never shipped.
- Consequence: **the `.env` on the VPS is rewritten on every deploy.** A `DATABASE_URL` line added to it by hand is gone after the next deploy.
- A guard counts the lines of the generated file: `[ "$(wc -l < .env)" -eq 23 ]` (`deploy.yml:186`). Adding a key means changing 23 to 24.
- `DATABASE_URL` is in none of these places today. The workflow does not pass it.
- **How the owner enters it (assumed, Q1):** `gh secret set DATABASE_URL`, typed at the prompt, never in a file in the repository and never in a manifest.
- **Alternative (Q1):** a second file, for example `/opt/hexagen-monaco/.env.database`, written by the owner on the VPS with mode 600 and added to `env_file` in the compose file. The password then never reaches GitHub. The deploy does not validate that file.

**Staging: k3s.**

- Existing patterns, both without a value in any manifest: `envFrom: secretRef: hexagen-web-env`, a Secret the owner creates on the node with `kubectl -n webapps create secret generic hexagen-web-env --from-env-file=/path/to/hexagen-web.env` (`deployment.yaml:37-40`; `deploy/k8s/staging/README.md:30-41`); and the deploy script's read-only check that returns key names and value lengths only (`deploy.sh:38`, `71-106`; README lines 13-15).
- For the staging database the README prescribes a `secretKeyRef` to the Secret `hexagen-pg-app`, key `uri`, which the CloudNativePG operator creates (`README.md:146-157`; `postgres/cluster.yaml:1-4`). The Deployment is not wired to it today (`deployment.yaml:41-55`).
- Other deploy directories: none. `deploy/` holds `docker-compose.prod.yml`, `.env.example` and `k8s/staging/` only.

**Exposure to know about.** The VPS is shared with other projects (`deploy.yml:152-156`). Anyone who can run `docker inspect hexagen-web` there can read the URL with its password.

### F6. Replacing `PLATFORM_DB=sqlite` with `DATABASE_URL`, per file, and the order

**What #872 does.** With `NODE_ENV=production` the service checks the choice at start, before the migrations (#872 `apps/web/instrumentation.ts:20-24`; `apps/web/lib/platform/production-db-choice.ts`). Neither variable set: it logs `[platform-db] refusing to start ...` and exits 1. Both set: Postgres is used and it logs `[platform-db] PLATFORM_DB=sqlite is ignored because DATABASE_URL is set; Postgres is used. Remove one of the two.` The image always runs with `NODE_ENV=production` (`apps/web/Dockerfile:133`).

**Per file (line numbers on the #872 branch).**

| File                                 | #872 adds                                                                                                                | The cutover does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/docker-compose.prod.yml`     | `- PLATFORM_DB=sqlite` with its comment, lines 32-35                                                                     | Remove lines 32-35. Add the CA mount under `volumes:`. Keep `QUOTA_DB_PATH` (the quota store stays on SQLite, ADR-0071 line 73) and keep `BYOK_DB_PATH` and `PLATFORM_DB_PATH`: they are unused while `DATABASE_URL` is set (`store.ts:150-153`; `byok-store.ts:321-324`) and are needed again on a rollback.                                                                                                                                                                                                                                                                                                                                          |
| `.github/workflows/deploy.yml`       | nothing                                                                                                                  | Four edits: `DATABASE_URL: ${{ secrets.DATABASE_URL }}` in the `env:` map (after line 126); `DATABASE_URL` appended to `envs:` (line 131); a `DATABASE_URL=\"$DATABASE_URL\"` line in the heredoc (after line 183); 23 becomes 24 on line 186, in the test and in the message. A fifth edit, required and not optional: before `docker load` (line 187), stop if `$DATABASE_URL` is empty or `aiven-ca.pem` is not a readable file. An empty secret must fail the deploy before the running container is touched (F11.1), and it is the only check that still works if `PLATFORM_DB=sqlite` is left behind somewhere (see "Both variables set" below). |
| `deploy/.env.example`                | a comment, lines 29-33                                                                                                   | Replace it with a `DATABASE_URL=` entry and the URL form of F4, with `<PASSWORD>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `deploy/k8s/staging/deployment.yaml` | `PLATFORM_DB` / `sqlite`, lines 56-60                                                                                    | Not part of the production cutover. When staging moves to its own Postgres, replace that entry with the `secretKeyRef` block of `README.md:149-153`. #872 already says so (README line 156).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `.github/workflows/lint.yml`         | `PLATFORM_DB: sqlite` for `standalone-smoke` (line 374); `-e PLATFORM_DB=sqlite` on the `container-smoke` run (line 502) | **Stay as they are.** Neither job has a database. They test packaging and the scan, not the store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Order.**

- **#872 first, then the cutover (recommended).** If the secret is missing, empty or misspelt, the service refuses to start and the deploy fails. Loud.
- **Cutover first, then #872.** On `main` today nothing reads `PLATFORM_DB`. With `DATABASE_URL` empty or missing the service silently opens `/data/platform.db` (`store.ts:150-153`). The deploy is green, because the health check asks `/api/auth/providers` and only wants a status below 500 (`docker-compose.prod.yml:41-50`). The owner would be on SQLite without knowing. In addition both pull requests edit the lines directly after `PLATFORM_DB_PATH` in the compose file, so the second one conflicts; the right resolution drops `PLATFORM_DB=sqlite`.
- **Both variables set** (for example the compose line kept by mistake). With a non-empty URL, Postgres is used and the warning above is logged at every start. With an EMPTY or misnamed `DATABASE_URL` secret it is not harmless: `PLATFORM_DB=sqlite` satisfies #872's check on its own (`production-db-choice.ts:25-30` on the #872 branch), no migration runs, the SQLite file is opened, and the deploy is green with no warning. The compose line therefore switches #872's refusal off, and removing it is part of the cutover, not tidying. `environment:` and `env_file:` are separate sources, so the line counts whenever it stays in the compose file.
- **#872 merged and deployed to production before the cutover is merged.** Production would run on SQLite on purpose, and the first signed-in user writes rows there. Do not run the Deploy workflow between the two merges (F7).

### F7. Today's SQLite data: is there a copy path?

- **A copy tool does not exist.** No SQLite-to-Postgres script is in the repository. `scripts/` has none; `docs/runbooks` does not exist; `staging-postgres-dumps` is not mentioned anywhere in this repository. The only mention of such a script is a plan that was never built: `scripts/etl-sqlite-to-postgres.mjs` in `docs/planning/2026-08-23-gcp-migration-plan.md:150`. The later plan dropped it (`docs/planning/2026-10-07_indexeddb-to-postgres-migration-plan.md:35`) and records "No proven data-migration tool exists" under what the owner accepted.
- **Production starts empty.** That is the decided path: "Production has no rows to carry. Its step is to run the migrations against the empty database on the first deploy after the freeze" (ADR-0071 line 84).
- **Is there a production deployment with real data today?** The repository says no, in documents and not in code: the production files were read on 2026-10-08 and the user, account, session, project, run, entitlement, BYOK and quota tables had 0 rows; the only rows were 3 seeded `model_prices` (plan §2.3, line 131; `deploy/k8s/staging/README.md:130-132`). The state today is **UNVERIFIED**. The ADR requires reading the counts again at the cutover (line 84; plan line 370). Step 2 of "The owner's steps" does that.
- **If a table is no longer empty,** stop. A tool would have to be written first. The tables that hold data that matters: `users`, `accounts`, `sessions`, `verification_tokens`; `saved_projects`, `project_owner_state`, `owner_documents`, `owner_document_revs`; `orgs`, `org_members`, `org_invites`, `teams`, `team_members`, `project_shares`; `entitlements`; `audit_log`; `run_events`, `scan_records`, `repair_runs`, `repair_attempts`; and from `byok.db`, `byok_key_metadata` and `byok_revocations`. After a load of BYOK rows the sequence must be advanced (`0003_byok.sql:4-7` gives the statement).
- **Signed-in browsers at the switch.** Sessions are signed cookies (`apps/web/app/lib/auth.ts:74`, `session: { strategy: "jwt" }`); the `sessions` table is not used for them. A request takes the owner id from the cookie without a database lookup (`apps/web/lib/platform/require-owner.ts:46-47`), and `saved_projects.owner_id` has no foreign key (`pg-migrations/0001_initial.sql:59-69`). A browser that signed in before the cutover therefore stays signed in, and its saves land in Postgres under an id that has no `users` row; the next real sign-in creates a new user with a fresh id (`auth-store.ts:168-169`) and those rows are unreachable. With 0 users on production this concerns the owner's own browser, but it costs nothing to close: set a new `AUTH_SECRET` repository secret before the cutover deploy (the deploy writes it into `.env`, `deploy.yml:162-163`), which signs every browser out. At the least, sign out before the deploy.
- **What does not move in any case:** `quota.db` stays a SQLite file (ADR-0071 line 73), and scan artifacts stay files under `/data/scan-artifacts` (`platform-db.ts:751-757`). The `/data` volume stays mounted and the deploy's writability check stays (`deploy.yml:190`).
- **Work that exists only in browsers.** Projects made before the account gate were never copied to the server on production (plan §2.3). After the cutover they are copied into Postgres when their owner first signs in. That mechanism was not read for this plan: **UNVERIFIED**.

### F8. The migration run

- **Who and where:** the service itself, inside the container, at start. `register()` calls `startPlatformMigrations(process.env)` when `DATABASE_URL` is non-empty (`apps/web/instrumentation.ts:20-24` on `main`). The GitHub runner never connects to the database. No agent and no person runs anything.
- **A CLI or script:** does not exist. No `migrate` script is in `package.json` or `apps/web/package.json`. The only "command" is starting the service.
- **What it prints.** First start on the empty database: `[platform-migrate] applied versions: [1, 2, 3]`. Later starts: `[platform-migrate] up to date`. On failure: `[platform-migrate] start-up migration failed; this build knows versions 1..3; code=<code>; <message>`, with the URL replaced by `[DATABASE_URL]` in the text, then exit status 1 (`pg-startup.ts:41-45`, `52-54`, `74-75`).
- **The lock.** One connection takes the session advisory lock `7302026100801` and waits at most 60 seconds for it (`pg-migrate.ts:6`, `99-105`; `pg-startup.ts:13-15`).
- **Two replicas.** The second waits for the lock, then finds everything applied and logs "up to date". If the first needs more than 60 seconds, the second fails with code `55P03`, exits 1 and is restarted. Production and staging both run one instance (`docker-compose.prod.yml:14-17`; `deployment.yaml:8-12`), and ADR-0071 line 91 keeps it at one.
- **Empty database.** The runner creates `schema_migrations` (`pg-migrate.ts:8-15`, `108`), then applies 1, 2 and 3 in order, each in its own transaction together with its bookkeeping row (lines 155-165). After it: 24 tables in `public` (23 from the migrations plus `schema_migrations`), 3 rows in `model_prices` (`0001:209-213`), 3 rows in `schema_migrations`.
- **Half-migrated database.** A migration that fails is rolled back whole (lines 166-173); the ones before it stay applied; the next start continues from there. All three current migrations are transactional (`pg-migrations/index.ts:17-25`).
- **What the runner refuses, with exit 1:**
  - a version in the database that this build does not know: "this build is older than the database" (lines 121-128). This is what an older image would hit after a newer one has migrated.
  - a gap in the applied versions (lines 130-138).
  - an applied migration whose file text has changed since: "Migration checksum mismatch" (lines 144-151).
  - tables that exist without a `schema_migrations` table (someone ran the SQL by hand): migration 1 fails with "already exists". The database must be emptied first.

### F9. Verification after the switch

- **A health endpoint that reports the database:** does not exist. There is no `/api/health`. The probe everywhere is `/api/auth/providers` with any status below 500 (`docker-compose.prod.yml:41-50`; `deployment.yaml:75-95`); it does not prove the database is in use.
- **A log line that names the store:** does not exist as such. The evidence is the `[platform-migrate]` line, which is printed only when `DATABASE_URL` is set (`instrumentation.ts:20`). No `[platform-migrate]` line in the log means the service is on SQLite.
- **Three checks, all in "The owner's steps":**
  1. The container log shows `[platform-migrate] applied versions: [1, 2, 3]` and no `[platform-db]` warning.
  2. As `hgxadmin`: `select version, name, applied_at from schema_migrations order by version;` returns `1 initial`, `2 owner_document_revs_and_audit_detail`, `3 byok`.
  3. After signing in and saving a project: `select count(*) from users;` and `select count(*) from saved_projects;` are above zero, and `/data/platform.db` on the volume has not changed its modification time. The first sign-in of an unknown account calls `createUser` (`apps/web/lib/platform/auth-store.ts:167-169`). If `users` is 0 after a save, the save was made with a cookie from before the cutover (F7): sign out, sign in, save again.

### F10. Rollback at each step, and the one-way doors

Per-step rollbacks are in the step table. The general picture:

- **Until the first user writes to Postgres, everything is reversible.** The SQLite files are not opened while `DATABASE_URL` is set and stay on the volume `hexagen-monaco-quota-data` (`docker-compose.prod.yml:52-57`). Going back means: `DATABASE_URL` out, `PLATFORM_DB=sqlite` in, recreate the container.
- **Fast way back, on the VPS:** edit `/opt/hexagen-monaco/.env` (delete the `DATABASE_URL` line, add `PLATFORM_DB=sqlite`), then `docker compose -f docker-compose.prod.yml up -d --force-recreate --wait`. The next deploy overwrites that `.env` (`deploy.yml:160`), so follow it by reverting the cutover pull request.
- **Slow way back:** revert the cutover pull request and run the Deploy workflow.
- **The previous image.** After a SUCCESSFUL deploy it is gone: the new image is loaded under the same tag and the old one pruned (`deploy.yml:187`, `192`). After a FAILED deploy it is still there, untagged: the script runs under `set -eu` (line 157) and stops at the failed `up --wait` (line 189) before the prune. Find it with `docker images -f dangling=true` and tag it back with `docker tag <id> hexagen-monaco-web:prod`.
- **Never run the Deploy workflow from a ref older than the cutover merge.** `gh workflow run deploy.yml --ref <older>` runs that ref's workflow file, whose `.env` has no `DATABASE_URL`, with that ref's compose file. Code from before #872 has no refusal and opens `/data/platform.db` (`store.ts:150-153`); the health check passes. The site would show none of the Postgres data and take new writes into the stale file, with a green deploy. To ship older application code, revert the application commits on `main`, keep the deploy files, and deploy `main`.

**One-way doors.**

1. **The first user write to Postgres.** After it, going back to the SQLite file loses every write since the switch. A Postgres-to-SQLite export does not exist, and the owner decided not to build one (ADR-0071 lines 83, 97; plan row D-13). From then on the only way back is a restore of the Postgres database. That is why the restore test (Q6) belongs before users are let in.
2. **The first applied migration.** The text of `0001` to `0003` is then fixed by checksum (`pg-migrate.ts:144-151`) and the column types are the stored format (ADR-0071 lines 58, 64). Undoing it while the database is still empty means emptying the database, which only the owner can do.
3. **The host.** Moving a live database to another host later is a second cutover (plan row D-3, line 292).

### F11. Other things in the code that would surprise

1. **A failed cutover deploy takes the site down.** `up -d --force-recreate --wait` (`deploy.yml:189`) replaces the running container. If the new one exits at start, `restart: unless-stopped` (`docker-compose.prod.yml:17`) restarts it in a loop and the deploy fails after 90 seconds. The previous image is still on the VPS, untagged (F10), but nothing puts it back by itself. Hence the required pre-check in the workflow (F6) and the pre-checks in the owner's steps.
2. **Pool size.** Platform pool 10 (`pg-db.ts:57`), BYOK pool 4 (`byok-store.ts:305`), one more connection during start-up (`pg-startup.ts:8-11`): up to 14 in steady state, 15 at start. The sizes are fixed in code; an environment variable for them does not exist. Aiven's limit for this plan is **UNVERIFIED** (Q5).
3. **Timeouts.**
   - `idle_in_transaction_session_timeout` is 30 seconds (`pg-db.ts:56`).
   - A statement timeout does not exist.
   - The runtime pools have no connect timeout (`pg-db.ts:58-60` sets one only when asked; only the start-up pool asks). If the database becomes unreachable, a request waits (`node_modules/pg-pool/index.js:206`) instead of failing quickly.
   - Idle connections close after 10 seconds (`pg-pool/index.js:98-99`). After a quiet moment the next request pays for a new TCP, TLS and login handshake to Aiven. The added latency is **UNVERIFIED**.
4. **Every transaction is SERIALIZABLE** with up to five attempts (`pg-db.ts:12`, `349`, `376-380`). Nothing to do; it explains `40001` retries if they appear in Aiven's logs.
5. **Build time against run time.** `DATABASE_URL` is read from `process.env` when the server runs (`instrumentation.ts:20`; `store.ts:150`; `byok-store.ts:321`). The build inlines only `APP_VERSION` and `COMMIT_HASH` (`apps/web/next.config.mjs:249-252`), and the Dockerfile takes only the three `NEXT_PUBLIC_*` build arguments (`apps/web/Dockerfile:24-31`). The URL is not baked into the image; the same image serves SQLite and Postgres.
6. **The container smoke test does not cover Postgres.** `container-smoke` boots the production image on SQLite (`lint.yml` line 497 on `main`, 502 with #872). The Postgres tests run from source on Node 22.7, not in the image on Node 20. Whether `pg` and the three `.sql` files (bundled through the rule at `next.config.mjs:273-277`) work inside the built image has, as far as the repository shows, never been exercised: staging is not wired (`deployment.yaml:41-55`). The first run of the image against Postgres may be production (Q7).
7. **The sslmode warning.** With `sslmode=require` the driver prints a security warning once per process (`pg-connection-string/index.js:219-230`). The recommended `sslmode=verify-full` prints none.
8. **IPv6.** The driver passes the host name to Node and does not pick an address family. Whether the Aiven name has an IPv6 address, and whether the container can reach it, is **UNVERIFIED**.
9. **Network allow-list.** The only machine that connects is the VPS; the GitHub runner does not. If the Aiven service restricts source addresses (**UNVERIFIED**), the VPS's outgoing address must be allowed.
10. **The error log hides the URL only as a whole string** (`pg-startup.ts:52`). A driver message that quotes part of it would not be caught. The messages read in the driver quote the host, not the password.

## Step table

| #   | Step                                  | Who                          | Command                                                          | Expected output                                                | Rollback                                | One-way?                         |
| --- | ------------------------------------- | ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------- | -------------------------------- |
| 1   | Merge #872                            | owner                        | merge in GitHub                                                  | CI green; nothing deployed                                     | revert the merge                        | no                               |
| 2   | Write the cutover pull request (F6)   | an agent, no secret involved | edits to `deploy.yml`, `docker-compose.prod.yml`, `.env.example` | CI green; the diff contains no URL and no password             | close it                                | no                               |
| 3   | Read-only checks on the database      | owner                        | `psql` as `hgxadmin` (owner's step 1)                            | 18.6; `public` creatable; no tables                            | none needed                             | no                               |
| 4   | Read the production SQLite row counts | owner                        | `docker exec` on the VPS (owner's step 2)                        | 0 rows everywhere except 3 in `model_prices`                   | none needed; if not zero, stop          | no                               |
| 5   | Place the CA file on the VPS          | owner                        | owner's step 3                                                   | file readable, certificate parses, TLS check passes            | delete the file                         | no                               |
| 6   | Set the repository secret             | owner                        | `gh secret set DATABASE_URL`                                     | listed by `gh secret list`                                     | `gh secret delete DATABASE_URL`         | no                               |
| 7   | Merge the cutover pull request        | owner                        | merge in GitHub                                                  | nothing deployed (the workflow is manual, `deploy.yml:3-4`)    | revert the merge                        | no                               |
| 8   | Deploy                                | owner                        | `gh workflow run deploy.yml`                                     | run green; log shows `applied versions: [1, 2, 3]`             | fast way back (F10), then revert step 7 | the migration is applied: door 2 |
| 9   | Verify                                | owner                        | owner's steps 7 to 9                                             | 3 migration rows; own account present; `platform.db` untouched | as step 8                               | no                               |
| 10  | Test a restore, record the date       | owner                        | Aiven's own tooling, **UNVERIFIED**                              | a restored copy answers the query of step 7                    | none needed                             | no                               |
| 11  | Let users in                          | owner                        | none                                                             | users sign in and save                                         | a Postgres restore only                 | **yes: door 1**                  |

## The owner's steps

One at a time. Do not start a step before the check of the one before it has passed. Wherever `<PASSWORD>` appears, you type it yourself; it goes into no file in the repository and into no chat.

**Before you start.** #872 is merged. The cutover pull request (F6) is reviewed and not yet merged. You have not run the Deploy workflow since the freeze.

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

**Step 2. Read the production SQLite row counts. Read-only, on the VPS.**

```sh
docker exec hexagen-web node -e "const D=require('node:module').createRequire('/app/apps/web/')('better-sqlite3');for(const f of ['platform','byok','quota']){try{const d=new D('/data/'+f+'.db',{readonly:true,fileMustExist:true});for(const t of d.prepare(\"select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name\").all())console.log(f,t.name,d.prepare('select count(*) n from \"'+t.name+'\"').get().n);d.close()}catch(e){console.log(f,'-',e.message)}}"
```

This command is adapted from `deploy/k8s/staging/sqlite-backup/sqlite-backup.cjs:24`, `40-56` and has not been run: **UNVERIFIED**.

Look for: every table 0, except `model_prices` 3. A file reported as missing is fine. If any other table has rows, stop here: there is no tool to carry them (F7).

**Step 3. Put the CA certificate on the VPS and test the path from there.**

Copy the same CA file to the VPS as `/opt/hexagen-monaco/aiven-ca.pem`, then on the VPS:

```sh
chmod 644 /opt/hexagen-monaco/aiven-ca.pem
openssl x509 -in /opt/hexagen-monaco/aiven-ca.pem -noout -subject -enddate
openssl s_client -starttls postgres -connect hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com:12194 -CAfile /opt/hexagen-monaco/aiven-ca.pem -verify_hostname hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com -verify_return_error </dev/null
```

Look for: a subject and an end date in the future from the second command; `Verify return code: 0 (ok)` from the third. The third command sends no password. It proves that the VPS reaches the service, that the CA is the right one, and that the host name matches. That this `openssl` supports `-starttls postgres` is **UNVERIFIED**. If it does not return 0, stop.

**Step 4. Set the secret.**

```sh
gh secret set DATABASE_URL --repo martinkrakowski/hexagen-monaco
```

At the prompt, paste one line, with your password in place of `<PASSWORD>`:

```
postgres://hgxadmin:<PASSWORD>@hexagen-monaco-krakowski-cloud-solutions.b.aivencloud.com:12194/hexagen?sslmode=verify-full&sslrootcert=/etc/hexagen/aiven-ca.pem
```

`/etc/hexagen/aiven-ca.pem` is the path inside the container and must equal the mount target in the cutover pull request. If the password has characters other than letters and digits, percent-encode them (F4).

```sh
gh secret list --repo martinkrakowski/hexagen-monaco
```

Look for: `DATABASE_URL` in the list with today's date.

Then give the application a new session secret, so that every browser is signed out at the cutover (F7):

```sh
openssl rand -base64 48 | gh secret set AUTH_SECRET --repo martinkrakowski/hexagen-monaco
```

The value goes from `openssl` to `gh` and is shown nowhere. Look for: `AUTH_SECRET` in `gh secret list` with today's date. (If you would rather not rotate it, see Q8; then signing out before step 6 matters.)

**Step 5. Merge the cutover pull request.**

Look for: CI green on `main`. Nothing is deployed by the merge.

**Step 6. Deploy.**

First run the command of step 2 again and look for the same result: the site was live while you did steps 3 to 5. If a table now has rows, stop. Then sign out of the application in your own browser.

```sh
gh workflow run deploy.yml --repo martinkrakowski/hexagen-monaco --ref main
gh run watch --repo martinkrakowski/hexagen-monaco
```

Look for: the run ends green. If it ends red, the site may be down (F11.1): go to "If something goes wrong".

Then on the VPS:

```sh
docker logs hexagen-web 2>&1 | grep -E '\[platform-(migrate|db)\]'
```

Look for: exactly `[platform-migrate] applied versions: [1, 2, 3]`. No line at all means the service is on SQLite. A `[platform-db] PLATFORM_DB=sqlite is ignored` line means the compose file still carries the opt-in.

**Step 7. Check the database.**

With the `psql` command of step 1:

```sql
select version, name, applied_at from schema_migrations order by version;
select count(*) from model_prices;
select count(*) as tables from information_schema.tables where table_schema = 'public';
```

Look for: three rows (`initial`, `owner_document_revs_and_audit_detail`, `byok`); 3; 24.

**Step 8. Note the SQLite file's time, then use the application.**

On the VPS:

```sh
docker exec hexagen-web sh -c 'stat -c "%y %n" /data/*.db'
```

(That the image's `stat` accepts `-c` is **UNVERIFIED**; plain `ls -l /data` shows the time to the minute.) Write down the time of `platform.db` and `byok.db`. Sign in at `https://app.hexagen-monaco.cloud` with your own account and save one project. Run the same command again.

Look for: both times unchanged. `quota.db` may change; it stays on SQLite on purpose.

**Step 9. Check your own rows.**

```sql
select count(*) from users;
select count(*) from saved_projects;
```

Look for: both above zero. If `users` is 0, your browser used a cookie from before the cutover: sign out, sign in, save again, and check that `AUTH_SECRET` was rotated (step 4). Up to here the only data in Postgres is your own, and going back loses nothing that matters.

**Step 10. Test a restore, before anyone else signs in.**

Restore the service's backup into a separate, throwaway service with Aiven's own tooling (how is **UNVERIFIED**), run the first query of step 7 against it, delete it, and record the date in this document. ADR-0071 line 51 asks for this.

Look for: the same three rows in the restored copy.

**Step 11. Let users in.**

This is the one-way door. From the first user's write, the way back is a Postgres restore and nothing else.

**If something goes wrong (before step 11).**

On the VPS:

```sh
# as the deploy user: .env is mode 600 and owned by it
cd /opt/hexagen-monaco
sed -i '/^DATABASE_URL=/d' .env
echo 'PLATFORM_DB=sqlite' >> .env
docker compose -f docker-compose.prod.yml up -d --force-recreate --wait --wait-timeout 90
docker logs hexagen-web 2>&1 | grep -E '\[platform-(migrate|db)\]'
```

Look for: the container healthy and no `[platform-migrate]` line; the service is back on the SQLite file. Then revert the cutover pull request, because the next deploy rewrites `.env`. The Aiven database can stay as it is: a later attempt finds its migrations applied and logs `[platform-migrate] up to date`.
