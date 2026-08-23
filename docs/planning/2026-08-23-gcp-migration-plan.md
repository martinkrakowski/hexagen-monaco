# VPS → GCP migration — implementation plan

**Date:** 2026-08-23
**Predecessor:** the 2026-08-20 hosting plan (`docs/planning/2026-08-20-hosting-migration-plan.md`, committed alongside this document in #634; its Wave H3 "Postgres + replicas" is gated D-H4 and "triggered only when someone pays")
**This plan overrides that trigger.** The move to GCP is being planned now, on its own merits, not on revenue evidence. Everything H3 said still holds as _engineering_ fact — ADR-0065/0064 must be amended before Postgres or a second replica — so that amendment is packet **G0.1**, first, not last.
**Companions:** the client-storage plan and the orgs/teams/sharing plan (same date). They land on whatever database this plan chooses; see §6.

Every file path, env var and constant below was read from the tree on 2026-08-23. Where the plan's inputs were wrong, the correction is recorded inline.

## 0. What is actually running today

From `deploy/docker-compose.prod.yml`, `apps/web/Dockerfile`, `.github/workflows/deploy.yml`, `deploy/.env.example`:

```
  GitHub Actions (deploy.yml, owner-triggered)
    preflight: npm view @hexagen-monaco/{sync,arch-linter}@<pkg version>   (F1 guard)
    docker build (node:20-alpine, Next standalone + traced CLI + manifest)
    docker save | gzip  ──scp──▶  VPS:/opt/hexagen-monaco/
    ssh: docker load; compose up -d --force-recreate --wait --wait-timeout 90
         + `test -w /data` probe as the nextjs user
                                         │
  VPS                                    ▼
    host-level reverse proxy + TLS (NOT in the repo) ──▶ 127.0.0.1:3000
    container hexagen-web  (image hexagen-monaco-web:prod, pull_policy: never)
      /data  = named volume hexagen-monaco-quota-data
                quota.db      (quota_usage)                        ← anon metering
                byok.db       (byok_key_metadata, byok_revocations) ← metadata only
                platform.db   (users, accounts, sessions, verification_tokens,
                               model_prices, project_owner_state, entitlements,
                               scan_records, repair_runs, repair_attempts,
                               saved projects + run history tables)
                scan-artifacts/  (handoff zips, findings.json — files, not rows;
                                  resolveScanArtifactsDir → /data/scan-artifacts)
      /app/.scan-workspaces  (HEXAGEN_SCAN_WORKSPACE_DIR; ephemeral per scan)
```

**Four durable things, not three.** The hosting plan counts three sqlite files. `platform-db.ts:378-390` also puts scan artifact _bytes_ on the same volume (`/data/scan-artifacts`), deliberately outside sqlite ("a 30 MB zip in a row would be paid for on every list()"). Any migration that moves the databases and forgets the directory loses every handoff zip.

**Runtime configuration** (23 keys in `deploy/.env.example`; the deploy writes them from GitHub secrets/vars): `NEXTAUTH_URL` (hardcoded), `NEXTAUTH_SECRET`/`AUTH_SECRET`, `GITHUB_ID`/`GITHUB_SECRET` (repo secrets `GH_OAUTH_ID`/`GH_OAUTH_SECRET`), `PLATFORM_DB_PATH`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_REPO_MONTHLY`, `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`, `WEB_LLM_API_KEY`, `INCEPTION_API_KEY`/`INCEPTION_MODEL`, `LLM_REASONING`, `STAGE1_REFINER_{API_KEY,BASE_URL,MODEL,MODE}`, `STAGE6_REVIEWER_{API_KEY,BASE_URL,MODEL}`; plus, written by `deploy.yml` but absent from `.env.example`: `STAGE6_VALIDATOR_{API_KEY,BASE_URL,MODEL,MAX_TOKENS}`, and compose-level `QUOTA_DB_PATH`/`BYOK_DB_PATH`. Three of these are **build args** (`NEXT_PUBLIC_LLM_AVAILABLE`, `NEXT_PUBLIC_LLM_MODEL`, `NEXT_PUBLIC_FREE_TIER_MODEL`) — baked into the image, so the image is environment-specific. `BROWNFIELD_GITHUB_SCAN` and `SCAN_ARTIFACTS_DIR` are read by code and set nowhere in the deploy: the GitHub-clone path is **default-off in production today**.

## 1. The workload, and what it rules out

| surface                                                                                                                                                                                                                                                                     | evidence                                                                                                                                                                                                                                    | consequence for compute                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Six SSE routes** — `manifest/generate/{spec,spec/convert,stage}`, `architecture/modify/stream`, `projects/bootstrap`, `projects/scan/github`                                                                                                                              | `text/event-stream` / `ReadableStream` in each `route.ts`; staged pipeline measured **mean 23.6 s, p95 38.8 s** (`staged-generation-baseline-findings.md:101`), before the Stage-7 repair leg; `spec/convert/route.ts:131` sends heartbeats | Any target must hold an open response for minutes. Cloud Run's 60-min request ceiling covers it; a load balancer's backend timeout must be raised above 30 s |
| **Scan subprocess** — `hexagen scan` via `execFile`, `SCAN_TIMEOUT_MS = 45_000`, stdout cap 16 MiB, workspace under `/app/.scan-workspaces` (must be under `/app`, not tmp)                                                                                                 | `cli-hexagen-scan.adapter.ts:49,238,325`; `limits.ts:18`; Dockerfile lines 116–128 explain why the walk-up resolver forbids `/tmp`                                                                                                          | Needs a writable filesystem inside the container and CPU _during_ the request — both fine on a VM; on Cloud Run the in-memory FS counts against instance RAM |
| **Tier-A/B uploads** — zip ≤ 32 MiB, ≤ 20 000 entries, ≤ 256 MiB unpacked                                                                                                                                                                                                   | `limits.ts:7,20,22`                                                                                                                                                                                                                         | Up to ~300 MiB transient disk per scan; size the instance for two concurrent scans                                                                           |
| **Tier-C GitHub clone** — `git clone --depth 1 --single-branch --no-tags`, preflight 10 s, clone 60 s, repo ≤ 128 MiB, on-disk kill at 384 MiB                                                                                                                              | `clone.ts:76,83,94,97,751,992`; kill switch `BROWNFIELD_GITHUB_SCAN` default **off** (`clone.ts:42-62`, `scan/github/route.ts:51`)                                                                                                          | **Correction to the brief:** the runner stage installs no `git` (only the builder does, `Dockerfile:15`). Turning Tier C on is an image change, not a flag   |
| **In-process state that forbids >1 replica** — rate limiter `Map` (`lib/rate-limiter.ts:3`); modify-flow singleton `cachedUseCase` (`wire.server.ts:686`) holding a transaction across three requests (`wire.server.ts:166-170`); anon quota in a single-writer sqlite file | verified; this is H3.2 in the hosting plan                                                                                                                                                                                                  | **Exactly one instance** until H3.2 lands. Every target below is configured for one instance first                                                           |
| **Synchronous store contracts** — `QuotaStore.consume/peek/snapshot`, `AuthRepository.*`, `PlatformStore.isProjectsInitialized` return values, not Promises                                                                                                                 | `quota-store.ts:87-124`, `auth-store.ts:34-42`, `store.ts:25-40`; 12 files call the singletons, incl. `enforce-quota.ts:59` — **a file ADR-0063 freezes**                                                                                   | Postgres is async. Moving a store to Postgres changes its contract, and one consumer of the quota contract cannot be edited without D-H3. See §3             |
| **Background jobs**                                                                                                                                                                                                                                                         | none — the only `setInterval`s are SSE heartbeats and a clone sampler                                                                                                                                                                       | Nothing needs a scheduler; no Cloud Scheduler/Tasks in scope                                                                                                 |
| **Egress**                                                                                                                                                                                                                                                                  | `api.github.com` + `github.com` (clone, hard-coded origin `clone.ts:300`), OpenRouter / Inception / OpenAI-compatible bases, Stripe, `registry.npmjs.org` (deploy preflight only, from the runner)                                          | No allow-listing exists today; none introduced                                                                                                               |

**What this rules out.** GKE: ADR-0065 deleted the manifests because a multi-node cluster with sqlite corrupts state; nothing in the table above changes that, and a one-node cluster is a VM with a control-plane bill. Not refuted, not chosen. Cloud Run _today_: possible at `min=max=1` with a 60-min timeout, 2 GiB+ memory for the in-memory workspace, and a persistent volume — but it gives up the thing Cloud Run is for (scale-out) until H3.2, and the clone/scan subprocess makes an in-memory filesystem the bottleneck. Step two, not step one.

## 2. Recommendation — two steps, each independently reversible

```
  step 1  GCE VM + the existing compose, sqlite on a persistent disk    (lift-and-shift)
  step 2  Cloud SQL Postgres for platform.db + byok.db; quota.db stays  (D-G2)
  step 3  Cloud Run, ≥2 instances                                        (after H3.2 + D-H3)
```

**Step 1 changes no application code.** Same image, same compose file, same health gate, same `.env` shape; only the deploy target and the TLS front move. It is the move that can be rehearsed in an afternoon and rolled back in minutes, and it is where the DNS cutover risk is spent — once, with nothing else changing at the same time.

**Step 2 is where the real engineering is**, and it is smaller than "three databases to Postgres" because one of the three should not move yet (§3).

**Step 3 is explicitly out of this plan's packets.** It is listed so the shape of step 1 and 2 is chosen to make it cheap (Artifact Registry image, Secret Manager, WIF, Cloud SQL private IP — all reused as-is).

## 3. Databases — what moves, what must not yet

| file                   | tables                                                                                                                                                                   | what it holds                                                                                                                                 | moves to Postgres?                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.db`          | users, accounts, sessions, verification_tokens, model_prices, project_owner_state, entitlements, scan_records, repair_runs, repair_attempts, saved projects, run history | Everything the orgs/teams and client-storage plans extend                                                                                     | **Yes, step 2.** Behind `PlatformStore` (`store.ts:25`): `AuthRepository`, `EntitlementRepository`, `SavedProjectsStore`, `RunHistoryRepository`, `ScanRecordsStore`                                     |
| `byok.db`              | byok_key_metadata (key_id, user_id, provider, key_version, created_at, revoked_at, revoked_by, write_seq), byok_revocations                                              | **Metadata and revocations only** — no ciphertext column exists (`byok-store.ts:90-115`). ADR-0030 holds; the ETL moves nothing it should not | **Yes, step 2.** Behind `ByokStore` (`byok-store.ts:34`). ADR-0063 names this file as _out of scope for metering policy_, i.e. not frozen                                                                |
| `quota.db`             | quota_usage                                                                                                                                                              | Anonymous free-tier metering keyed by `hxg_sid`                                                                                               | **No — not until D-H3.** `enforce-quota.ts:59` calls `consume()` synchronously and ADR-0063 freezes that file. A Postgres `QuotaStore` is async by nature. The store itself is not frozen; its caller is |
| `/data/scan-artifacts` | files                                                                                                                                                                    | handoff zips, `findings.json`                                                                                                                 | **To a GCS bucket**, step 2, behind `resolveScanArtifactsDir` — or stays on the persistent disk at step 1 with no change                                                                                 |

**The honest cost of step 2 is the sync→async contract change**, not SQL dialect. The stores already avoid sqlite-only syntax (`ON CONFLICT` ×9 and `RETURNING` ×3 are both Postgres-native; one `PRAGMA user_version` is the migration counter and becomes a `schema_version` row). But every method on `AuthRepository`, `EntitlementRepository`, `SavedProjectsStore`, `RunHistoryRepository`, `ScanRecordsStore`, `ByokStore` returns a value today; with Postgres each returns a Promise, and the 12 call-site files plus the NextAuth adapter wrapper (`auth.ts:12`, `createNextAuthAdapter`) change with them. That is an L packet on its own and is the reason `quota.db` stays put: its one frozen caller cannot take an `await`.

**Interim for quota (step 1 and 2):** sqlite on the GCE persistent disk, single instance. That is exactly today's guarantee. It caps the platform at one instance until D-H3 unfreezes `enforce-quota.ts`; step 3 depends on it.

## 4. Packets

Sizes: S ≤ half a day, M ≤ two days, L ≤ a week, XL more. Every exit criterion names the thing that must be observed failing or succeeding — a green dashboard is not an exit.

### G0 — decisions and prerequisites

**G0.1 — Amend ADR-0065 and ADR-0064** · **S** · blocks everything

- _What:_ ADR-0065's "single-container compose is canonical" stays true for step 1 and gains a dated amendment: the host is a GCE VM; the database tier moves to Cloud SQL at step 2 (the "Phase 2 … appropriate distributed database" its Consequences section reserves, `ADR-0065:18`); replica count stays 1 until H3.2. ADR-0064 is already superseded (#629); its amendment gets one line pointing here.
- _Exit:_ both ADRs carry the amendment and `docs/index.md` agrees; the hosting plan's D-H4 row is marked "decided by G0.1".

**G0.2 — Commit the 2026-08-20 hosting plan** · **S** · _done in #634_

- _What:_ this plan and its two companions cite it; it was untracked when this plan was drafted. Landed as written in #634 (`05f47fb4`); the override of its H3 trigger is recorded here and in its successors rather than by editing it.
- _Exit:_ the three cross-references resolve on `main` — met by #634.

**G0.3 — GCP project scaffold** · **M** · needs D-G1, D-G3

- _What:_ one project, one region (D-G3), VPC with a private subnet, Artifact Registry repo, Secret Manager secrets for every key in §0 (23 + the 4 validator keys), Workload Identity Federation pool + provider for `github.com/<owner>/hexagen-monaco` with a deploy service account that can push images and SSH/SCP — **no downloaded SA keys**. Terraform or plain `gcloud` scripts checked into `deploy/gcp/`; either is fine, but it must be re-runnable.
- _Exit:_ **mutation:** delete the Artifact Registry repo and re-run the scaffold; it comes back identical. A GitHub Actions job authenticates via WIF and lists the registry — no key in any secret.

### G1 — step 1: lift-and-shift to GCE

**G1.1 — VM + disk** · **S**

- _What:_ `e2-small` (2 vCPU shared, 2 GiB) is the floor for one concurrent scan at the §1 limits; `e2-medium` (4 GiB) if two scans or a Stage-7 repair run concurrently. Container-Optimized OS or Debian + Docker — Debian, because the VPS runbook assumes `docker compose` and COS does not ship it. A separate 20 GiB `pd-balanced` mounted at `/opt/hexagen-monaco/data`, **snapshotted hourly** by a resource policy. The compose's named volume `hexagen-monaco-quota-data` becomes a bind to that disk — one-line compose change, the only one in step 1.
- _Exit:_ `test -w /data` as the `nextjs` user inside the container (the deploy already asserts this); snapshot policy verified by restoring a snapshot to a scratch disk and opening `platform.db` from it.

**G1.2 — Ingress and TLS** · **M** · needs D-G4

- _What:_ the VPS proxy is host-level and not in the repo (`docker-compose.prod.yml` header; `managed-deploy-compose.md:68-69`) — so step 1 must _build_ an ingress, not copy one. Default (D-G4): a global external HTTPS load balancer with a Google-managed certificate for `app.hexagen-monaco.cloud`, an unmanaged instance group of the one VM, backend timeout raised to **3600 s** (SSE; default 30 s would cut every generation mid-stream), HTTP→HTTPS redirect, the health check on `/api/auth/providers` (what compose already probes). Alternative: Caddy on the VM — cheaper, but then TLS is again host-level and out of the repo, which is the thing being fixed.
- _Exit:_ **mutation:** set the backend timeout to 30 s on a scratch backend and confirm a `/api/manifest/generate/stage` stream is cut; restore to 3600 s and confirm a full p95-length generation completes through the LB. `curl -I https://<lb-ip>` with a Host header returns the app's 308/200 before DNS moves.

**G1.3 — `deploy.yml` retarget** · **M**

- _What:_ build → `docker push` to Artifact Registry (replaces `docker save | scp`) → SSH to the VM (still `appleboy/ssh-action`, keyed via a short-lived OS Login cert or IAP TCP forwarding — D-G5) → `docker pull` + the same `compose up -d --force-recreate --wait` + `test -w /data`. **Keep the npm-404 preflight and the health gate verbatim.** The `.env` is still written by the workflow from GitHub secrets at step 1; Secret Manager takes over at G2.3. Compose's `pull_policy: never` becomes `always` and `image:` becomes the registry path.
- _Exit:_ a deploy to the VM goes green; **mutation:** push an image whose `CMD` exits 1 — the `--wait` gate fails the workflow and the previous container keeps serving (`restart: unless-stopped`). Record the wall-clock of one deploy.

**G1.4 — Data move and cutover** · **M** · the only packet with a data-loss window

- _What:_ see §7 runbook. sqlite files copy with an online backup (`better-sqlite3` `.backup()` via `node -e`, the H0.1 trick — the runner image has no `sqlite3` CLI) so the copy is consistent while the VPS keeps serving; `scan-artifacts/` with `rsync`. DNS TTL lowered to 60 s **24 h before**; final delta copy during a ≤ 10-minute write freeze.
- _Exit:_ on GCP, signed-in user sees their saved projects and run history; an anonymous session's quota count carried over (`GET /api/free-tier/quota` matches a value captured on the VPS minutes earlier); a Tier-A scan completes end-to-end and its handoff zip downloads. **Then:** stop the VPS container and confirm the GCP uptime check stays green for one hour.

**G1.5 — Observability floor** · **S**

- _What:_ Cloud Logging via the Docker `gcplogs` driver (one compose line); an uptime check on `https://app.hexagen-monaco.cloud/api/auth/providers` every 60 s from three regions with an alerting policy to email; a disk-usage alert at 80 % on the data disk (the scan workspace and artifacts grow it).
- _Exit:_ **mutation:** `docker stop hexagen-web`; the alert fires within 5 min; `docker start`; it resolves.

### G2 — step 2: managed database tier

**G2.1 — Cloud SQL for PostgreSQL** · **M** · needs D-G2

- _What:_ one instance, `db-g1-small` (shared core, 1.7 GiB) is enough for the row counts involved; private IP on the VPC, no public IP; connect from the VM via the Cloud SQL Auth Proxy as a compose sidecar (`gcr.io/cloud-sql-connectors/cloud-sql-proxy`) on the loopback network — the app sees `localhost:5432`, no certificate handling in code. Automated backups + PITR (7 days). This **replaces H0.1's cron** for the tables it holds; the sqlite files still on disk keep the snapshot policy from G1.1.
- _Exit:_ PITR restore drill to a scratch instance, documented with the timestamp used.

**G2.2 — Async store contracts + Postgres adapters** · **L** · the real work

- _What:_ for each interface in §3 (`AuthRepository`, `EntitlementRepository`, `SavedProjectsStore`, `RunHistoryRepository`, `ScanRecordsStore`, `ByokStore`): make the interface async, port the 12 caller files, write a `pg` implementation alongside the better-sqlite3 one, select by `DATABASE_URL` presence. **`QuotaStore` is excluded** (§3). Migrations: replace `PRAGMA user_version` with a `schema_version` table; the in-file migration functions (`migrateSavedProjects` style) stay the pattern, one per interface. better-sqlite3 stays the test backend (ADR-0044 suites run without a server) — which means **every store gets a contract test that runs against both backends**, or the Postgres path ships untested.
- _Exit:_ the dual-backend contract suite is green on both; **mutation:** break one Postgres statement's column name — the contract suite goes red on Postgres only. `yarn typecheck` proves no sync call site survived (a `.consume(` without `await` on a Promise-returning method is a type error only if the return type changed — assert it did with a test that calls each method and checks `instanceof Promise`).

**G2.3 — Secrets → Secret Manager; `.env` stops being written by CI** · **S**

- _What:_ the VM's service account reads the 27 secrets at container start through a tiny entrypoint (or the compose `secrets:` indirection via `gcloud secrets versions access`); `deploy.yml` no longer carries secret values, only the image tag. Build args remain build args — **the three `NEXT_PUBLIC_*` values still bake into the image**, so a model flip still needs a rebuild. Note this as a known limitation; fixing it is a Next.js runtime-config change outside this plan.
- _Exit:_ `grep -c "secrets\." deploy.yml` drops to the WIF/registry entries only; a rotated `NEXTAUTH_SECRET` in Secret Manager takes effect on the next `compose up` without a workflow edit.

**G2.4 — One-shot ETL** · **M**

- _What:_ `scripts/etl-sqlite-to-postgres.mjs`: open each sqlite file read-only via better-sqlite3, stream rows through the _interfaces_ (not raw SQL) into the Postgres adapters, so the ETL is exercised by the same contract suite. Idempotent — re-running upserts. Runs during a second ≤ 10-minute write freeze; `platform.db` and `byok.db` then become read-only files kept on the disk for 30 days (rollback material), `quota.db` stays live.
- _Exit:_ row counts per table match between sqlite and Postgres, printed by the script and pasted in the PR; a signed-in user's project list is byte-identical before and after.

**G2.5 — Scan artifacts → GCS** · **S**

- _What:_ `resolveScanArtifactsDir` gains a `gs://` branch behind a small port (`writeArtifact`/`readArtifact`); bucket with a 90-day lifecycle rule (artifacts are re-creatable by re-running a scan). The row store (`scan-records-store.ts`) is untouched — it already does no filesystem I/O.
- _Exit:_ a handoff zip written on GCP downloads through the existing route; **mutation:** revoke the VM SA's bucket role — the scan route returns its structured "could not run" envelope, not a 500.

### G3 — step 3 (out of scope here; shape only)

Cloud Run with `min-instances=1`, Cloud SQL via the built-in connector, the GCS artifact port already in place. **Blocked on** H3.2 (rate limiter and modify-flow singleton → Postgres-backed) and **D-H3** (unfreeze `enforce-quota.ts` so quota can leave sqlite). Until both land, a second instance corrupts quota state and loses modify-flow transactions; nothing in G1/G2 makes that safe, and this plan does not pretend otherwise.

## 5. Decisions

| id       | question                                                                                                                                                                                                                                                                               | default if unanswered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-0**  | API host for the new platform routes: Next.js route handlers in `apps/web` (status quo), or a separate `apps/api` Nitro service scaffolded from the repo's own generator (`packages/sync/src/generators/apps-framework-templates.ts`)? — shared gate across all three 2026-08-23 plans | **Status quo for this plan's two steps as ordered.** **If Nitro is chosen, the order inverts:** G2 (Cloud SQL Postgres) must precede G1's cutover, because `apps/web` and `apps/api` cannot both open the sqlite files on one disk; G0.1's ADR-0065 amendment must cover a second container; G1.2's LB gains path routing (`/api/*` → Nitro). In exchange the platform CRUD (accounts, orgs, teams, shares, documents, runs, billing) is exactly the short, stateless request shape Cloud Run wants — the SSE pipeline, the clone+scan subprocess and the BYOK proxy are what keep the Next app on a VM, and they would stay there. That is the strongest argument for the split and the reason it is a gate rather than a rejection. |
| **D-G1** | Compute target for the first move                                                                                                                                                                                                                                                      | **GCE VM + existing compose.** Zero application change; the replica limits in §1 mean Cloud Run buys nothing yet. Revisit at G3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **D-G2** | Postgres at step 1, or sqlite-on-persistent-disk first?                                                                                                                                                                                                                                | **Sqlite first, Postgres at G2.** Two risks in one cutover is how data is lost. The disk + hourly snapshots already beat the VPS's (absent) backup story.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **D-G3** | Region                                                                                                                                                                                                                                                                                 | **`europe-west1` (Belgium)** if users are EU-centred, else `us-east1`. Single region; no multi-region until there is a paying HA requirement. Note: Cloud SQL and the VM must share it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **D-G4** | Ingress: external HTTPS LB + managed cert, or Caddy on the VM?                                                                                                                                                                                                                         | **LB.** ~$18/mo buys TLS in the repo, a health-checked front, and the exact piece Cloud Run needs later. The 3600 s backend timeout is mandatory either way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **D-G5** | CI → VM transport: SSH key secret, OS Login short-lived cert, or IAP?                                                                                                                                                                                                                  | **IAP TCP forwarding with WIF.** No static key anywhere; the VM has no public SSH port.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **D-G6** | `BROWNFIELD_GITHUB_SCAN` on GCP                                                                                                                                                                                                                                                        | **Stays off** until `git` is added to the runner stage in its own PR with the egress note. Not a migration concern; recorded so nobody assumes the move enables it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D-G7** | Keep the VPS as warm standby after cutover, and for how long?                                                                                                                                                                                                                          | **30 days**, container stopped, data disk intact, DNS TTL back to 300 s after 7 days. Past 30 days rollback is a restore, not a flip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 6. Sequencing and what the companion plans depend on

```
G0.1 amend ADRs ─▶ G0.2 commit hosting plan ─▶ G0.3 GCP scaffold (WIF, AR, SM, VPC)
                                                       │
            ┌──────────────────────────────────────────┘
            ▼
  G1.1 VM+disk ─▶ G1.2 LB/TLS ─▶ G1.3 deploy.yml ─▶ G1.4 cutover ─▶ G1.5 observability
                                                        │
                        (serve from GCP on sqlite; VPS warm standby, D-G7)
                                                        ▼
  G2.1 Cloud SQL ─▶ G2.2 async stores + pg adapters ─▶ G2.4 ETL ─▶ G2.5 artifacts→GCS
                     ▲                                   G2.3 Secret Manager (any time after G1.4)
                     │
   orgs/teams plan (H1.1 schema, grants) and client-storage plan (new tables)
   land on the SavedProjectsStore / PlatformStore interfaces — write them
   SQLite-first through the in-file migration style; G2.2 ports whatever
   exists at that point. Landing them AFTER G2.2 means writing them once, async.
                                                        │
                                                        ▼
  G3 Cloud Run ◀── H3.2 replica safety ◀── D-H3 unfreeze enforce-quota.ts
```

**Parallel-safe:** G0.3 can run alongside G0.1/G0.2. G1.2 and G1.3 can be built against the VM before any data moves. G2.3 is independent of G2.1/G2.2.

**Ordering note for the companions.** If the orgs/teams and client-storage plans ship before G2.2, they add sqlite tables that G2.2 then ports (more ETL rows, same pattern). If they ship after, they are written async once. Either order works; **what does not work is shipping them _during_ G2.2** — two migration styles on the same tables.

## 7. Cutover runbook (G1.4)

**Go / no-go (all must be true):** G1.1–G1.3, G1.5 green on the VM · a deploy has run end-to-end to the VM from `deploy.yml` · LB serves the app on its IP with the Host header · DNS TTL has been 60 s for ≥ 24 h · VPS snapshot taken (`.backup()` copies of all three dbs + `scan-artifacts` tarball, stored in GCS) · the owner is available for the freeze window.

1. Announce a 10-minute write freeze (the app has no maintenance mode; the freeze is "do not deploy, do not use" — acceptable at current traffic, and the only honest statement).
2. On the VPS: `docker compose … exec web node -e "<better-sqlite3 .backup() for each db>"` to `/opt/hexagen-monaco/cutover/`; `rsync -a /data/scan-artifacts/ …/cutover/scan-artifacts/`.
3. `gcloud storage rsync` the cutover directory to the GCS bucket; `gcloud compute scp` (via IAP) from the bucket to the VM's data disk.
4. On the VM: `compose up -d --wait`; the deploy's `test -w /data` probe; `curl` the three exit checks in G1.4 against the LB IP with the Host header.
5. Flip DNS `app.hexagen-monaco.cloud` → LB IP.
6. Watch the uptime check and Cloud Logging for 15 min; run one signed-in project save and one anonymous generation.
7. Stop (do not remove) the VPS container. Lift the freeze.
8. After 7 days: DNS TTL back to 300 s. After 30 days (D-G7): decommission.

**Rollback at each step:** before step 5 — nothing to roll back; abandon and retry. Between 5 and 7 — flip DNS back (≤ 60 s propagation) and copy the _GCP_ data disk contents back to the VPS the same way (direction reverses; writes that landed on GCP during the window are the ones at risk and must be copied, not discarded). After step 7 — restart the VPS container, flip DNS, same copy-back; the window of divergent writes is bounded by the time since step 5 and is the only data at risk in this plan. **Post-G2.4 rollback is a Postgres→sqlite export, not a file copy** — write and drill that script as part of G2.4 or accept that G2 is one-way.

## 8. Cost (estimates, list prices, one region; the VPS price is not known to this plan, so the comparison is qualitative)

| shape                                                                | monthly, approx.                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Step 1:** `e2-small` + 20 GiB pd-balanced + hourly snapshots       | $15–25 compute, $2–4 disk, $1–3 snapshots                                                |
| external HTTPS LB (forwarding rule + managed cert)                   | ~$18–20 fixed + per-GB processed (negligible at this traffic)                            |
| Artifact Registry + Cloud Logging/Monitoring + egress                | $1–5 (image ~1 GiB × a few versions; logs within free tier; egress to LLM APIs is small) |
| **Step 1 total**                                                     | **≈ $40–55**                                                                             |
| **Step 2 adds:** Cloud SQL `db-g1-small` + 10 GiB SSD + backups/PITR | $25–35 + $2–5                                                                            |
| GCS artifacts bucket with 90-day lifecycle                           | < $1                                                                                     |
| **Step 2 total**                                                     | **≈ $70–95**                                                                             |
| `e2-medium` instead of `e2-small` (two concurrent scans)             | +$10–15                                                                                  |

A single VPS is almost certainly cheaper in cash. What the GCP shape buys is an ingress in the repo, hourly snapshots, PITR, secret rotation without a workflow edit, and a deploy path that does not hold a static SSH key — none of which the VPS has today.

## 9. What this plan does not do

| excluded                                           | why                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Cloud Run / second replica (G3)                    | Blocked on H3.2 and D-H3; see §4 G3. Planned shape, no packets.                   |
| Moving `quota.db` to Postgres                      | Its caller `enforce-quota.ts` is ADR-0063-frozen and synchronous. D-H3 first.     |
| Enabling Tier-C GitHub clone                       | `git` is not in the runner image; own PR (D-G6).                                  |
| Runtime-configurable `NEXT_PUBLIC_*`               | Build args by Next.js design; out of scope, noted in G2.3.                        |
| Multi-region, HA, read replicas                    | No requirement exists; ADR-0065 amendment keeps replicas = 1.                     |
| Changing the metering policy or the 8 frozen files | ADR-0063.                                                                         |
| A maintenance-mode page                            | Would be nice for the freeze; not built — the freeze is announced, not enforced.  |
| GKE                                                | ADR-0065's reasoning stands; a one-node cluster is a VM with a control-plane fee. |

## 10. Risks

| risk                                                                          | mitigation                                                                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| LB backend timeout cuts SSE streams (default 30 s vs p95 ≈ 39 s + repair leg) | G1.2 sets 3600 s and its exit criterion _proves the cut_ at 30 s first.                                                                   |
| Writes lost in the cutover window                                             | ≤ 10-minute announced freeze; 60 s TTL; copy-back direction documented; the window is the only data at risk and it is bounded.            |
| Forgetting `scan-artifacts/` (the fourth durable thing)                       | Named in §0; G1.4 exit requires a pre-cutover handoff zip to download post-cutover.                                                       |
| G2.2 sync→async ripple breaks a route silently                                | Dual-backend contract suite + the `instanceof Promise` assertion per method; typecheck is not sufficient on its own and the plan says so. |
| Someone sets `min-instances=2` or adds a replica before H3.2                  | ADR-0065 amendment states replicas = 1 with the reason; G3 is written as blocked, not pending.                                            |
| Image is environment-specific (`NEXT_PUBLIC_*` build args)                    | Unchanged from today; recorded in G2.3 so Artifact Registry tags are not mistaken for environment-agnostic.                               |
| Cost overrun from scan disk growth                                            | 80 % disk alert (G1.5); GCS lifecycle (G2.5); scan workspaces are deleted in `finally` by every creator (Dockerfile 124–128).             |
| Tier-C clone silently assumed to work on GCP                                  | D-G6; the runner has no `git`, verified.                                                                                                  |
| The 2026-08-20 plan's H3 trigger is read as still governing                   | G0.2 — its successors record the override; the plan itself is unedited.                                                                   |
