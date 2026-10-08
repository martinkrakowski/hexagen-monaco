# Staging deploy (k3s on midnight)

`yarn deploy:staging` builds the web app image from the tracked files at `HEAD`,
pushes it to Harbor, and updates `deployment/hexagen-web` in namespace
`webapps`, served at `https://hexagen.midnight.lan`. It is separate from the
production deploy (the manually started `deploy.yml` workflow), which it never
calls.

## What the script does

1. Refuses a dirty tree. Untracked files count as dirty, intentionally.
   The tag is `git rev-parse --short HEAD`.
2. Checks that Secret `hexagen-web-env` exists and every required key is
   present and non-empty. The check runs on the node and only key names and
   value lengths come back.
3. Builds with `git archive HEAD | docker --context midnight build`, so only
   tracked files reach the image. The `NEXT_PUBLIC_*` build args are public
   values read from `build-args.env`.
4. Pushes `registry.midnight.lan/library/hexagen-monaco:<tag>`.
5. Renders `deploy/k8s/staging` with that image, applies it over `ssh m`, and
   waits for the rollout.

Options: no argument asks for confirmation on a TTY; `--yes` skips the prompt
(required without a TTY); `--dry-run` renders the manifests, runs the secret
check, prints the build and push commands, then runs `kubectl apply
--dry-run=server` and `kubectl diff` on the node. It builds, pushes and applies
nothing. Overrides: `STAGING_DOCKER_CONTEXT` (default `midnight`),
`STAGING_SSH` (default `m`).

## Secret

The owner creates the Secret on the node. Neither the script nor the repo ever
holds its values. On the node, with an env file you wrote there (not committed):

```sh
kubectl -n webapps create secret generic hexagen-web-env --from-env-file=/path/to/hexagen-web.env
```

Do not quote values in the env file: `--from-env-file` keeps the quotes, so
`KEY="v"` is stored as `"v"` (and an empty `KEY=""` as two characters). The
script fails a required key whose value starts with a quote character.

Required keys (the script refuses to deploy without them):

- Auth: `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`. The app reads
  `NEXTAUTH_SECRET ?? AUTH_SECRET` (next-auth 4.24.13). We standardise on
  `NEXTAUTH_SECRET`, and that is the key the script checks.
- LLM: `LLM_BASE_URL`, `LLM_MODEL`, `WEB_LLM_API_KEY`, `INCEPTION_API_KEY`.

Optional: `LLM_API_KEY`, `INCEPTION_MODEL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_REPO_MONTHLY` (Stripe cannot deliver webhooks to a `.lan` host,
so billing stays off on staging unless these are set), `LLM_REASONING`, `STAGE1_REFINER_*`, `STAGE6_REVIEWER_*`,
`STAGE6_VALIDATOR_API_KEY`, `STAGE6_VALIDATOR_BASE_URL`,
`STAGE6_VALIDATOR_MODEL`, `STAGE6_VALIDATOR_MAX_TOKENS`. Leaving the
refiner and reviewer keys unset turns those stages off. See `deploy/.env.example`.

`NEXT_PUBLIC_LLM_MODEL` in `build-args.env` must equal the Secret's `LLM_MODEL`.

The GitHub OAuth App's callback URL must be
`https://hexagen.midnight.lan/api/auth/callback/github`.

## Decisions

- A deploy outage of roughly 30-90 s (Recreate) is accepted.
- The StorageClass keeps `reclaimPolicy: Delete`; we rely on backups.
- `NEXT_PUBLIC_LLM_MODEL=z-ai/glm-5.2` stays.
- Stripe is optional on staging.
- `LLM_API_KEY` is optional: prod runs without it after the mercury flip, and
  chat and governance read `WEB_LLM_API_KEY ?? LLM_API_KEY`.
- `INCEPTION_MODEL` is optional: it defaults to `mercury-2`.

## State

The three SQLite files (`quota.db`, `byok.db`, `platform.db`) live on PVC
`hexagen-web-data` (1Gi, local-path, ReadWriteOnce) mounted at `/data`.
local-path creates the directory root-owned with mode 0777 (its setup script
runs `mkdir -m 0777`), so the pod runs fully non-root as uid 1001 with no
initContainer. If the provisioner's setup script is ever changed to a stricter
mode, add a root initContainer limited to `chown 1001:1001 /data`.

The StorageClass has `reclaimPolicy: Delete`: deleting the PVC, the
kustomization or the namespace destroys the databases. The 1Gi size is
effectively immutable. Back up before risky changes, either with `kubectl cp`
while the pod is quiescent, or with `sqlite3 <db> ".backup <file>"` in a debug
pod that mounts the claim.

## Postgres (staging database)

`deploy/k8s/staging/postgres/` holds a one-instance Postgres 18 cluster,
`hexagen-pg`, for the CloudNativePG operator already installed on the node. It
is a separate kustomization: `yarn deploy:staging` never renders it, so an app
deploy cannot change or delete the database.

**The app does not use it yet.** Nothing in the web app reads `DATABASE_URL`
today; the SQLite files under `/data` remain the only store until the Postgres
implementation lands (packet B2 of
`docs/planning/2026-10-07_indexeddb-to-postgres-migration-plan.md`) and the
staging data has been carried over (packet B4). The Deployment is therefore
not wired to the database in this change. When B4 is ready, add this to the
`env:` list in `deployment.yaml`:

```yaml
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: hexagen-pg-app
      key: uri
```

The operator creates Secret `hexagen-pg-app` and Service `hexagen-pg-rw` in
`webapps`. The repo and the scripts never hold the password.

### Apply

By hand, from the repository root, and only when the owner says so. The first
command changes nothing; read its output before running the second.

```sh
kubectl kustomize deploy/k8s/staging/postgres | ssh m 'KUBECONFIG=$HOME/.kube/config kubectl apply --dry-run=server -f -'
kubectl kustomize deploy/k8s/staging/postgres | ssh m 'KUBECONFIG=$HOME/.kube/config kubectl apply -f -'
ssh m 'KUBECONFIG=$HOME/.kube/config kubectl -n webapps wait --for=condition=Ready cluster/hexagen-pg --timeout=5m'
```

It creates three objects: Cluster `hexagen-pg` (requests 100m CPU and 256Mi,
memory limit 1Gi, a 5Gi claim), PersistentVolumeClaim `hexagen-pg-dumps` (2Gi)
and CronJob `hexagen-pg-dump`.

### Backup

CronJob `hexagen-pg-dump` runs `pg_dump --format=custom` at 03:17 UTC every
day into `hexagen-pg-dumps`, reads the whole dump back with `pg_restore`
before giving it its final name, and keeps the seven newest. Run one now (the
name carries the time, so the command can be repeated; a finished job can be
deleted, its dump stays):

```sh
ssh m 'KUBECONFIG=$HOME/.kube/config kubectl -n webapps create job --from=cronjob/hexagen-pg-dump hexagen-pg-dump-manual-$(date +%s)'
```

**What the dumps do not cover.** Both claims are `local-path` on the node's one
disk, with `reclaimPolicy: Delete`. The dumps survive a bad migration, a
dropped table, and the deletion of the Cluster or of its own claim. They do
not survive the loss of that disk, the deletion of `hexagen-pg-dumps`, or the
deletion of the namespace. A copy off the node is a host decision and is not
made here. Until one exists, treat staging data as rebuildable: it can be
re-created from the SQLite files by re-running the B4 carry-over.

There is no point-in-time recovery: a restore returns the database to the
last nightly dump.

### Restore drill

Restore the newest dump into a scratch database on the same cluster and count
a table; drop the scratch database afterwards. Record the date of the last
drill here: _none yet_.

### Remove

Deleting the Cluster deletes its claim and its data. Take a dump first, and
never run `kubectl delete -k deploy/k8s/staging/postgres`: that removes the
dumps claim as well.

## TLS

cert-manager issues `hexagen-web-tls` from ClusterIssuer `midnight-ca`. A
Traefik `Middleware` `redirect-https` redirects http to https; the Ingress
references it as `webapps-redirect-https@kubernetescrd` (`<namespace>-<name>`;
a wrong name makes Traefik 404 the whole host). Clients must trust the midnight
CA. Check without installing it:

```sh
curl --cacert /path/to/midnight-ca.crt https://hexagen.midnight.lan/api/auth/providers
```

## First deploy

- Replicas go from 2 to 1 and the strategy becomes `Recreate`, so each deploy
  has downtime of roughly 30-90 s (one writer on the SQLite volume).
- The PVC starts empty: accounts, projects and quotas start fresh.
- The first real build also verifies that `-f apps/web/Dockerfile` resolves
  with a tar on stdin; if it does not, the build fails before anything is
  pushed.
- `imagePullPolicy` is `IfNotPresent`: re-pushing an existing tag is not
  re-pulled by the node. Every deploy uses a new commit tag.

## Roll back

Fast path: `kubectl -n webapps rollout undo deployment/hexagen-web`, or
`kubectl -n webapps set image deployment/hexagen-web web=registry.midnight.lan/library/hexagen-monaco:<previous-tag>`.
Slower: check out an older commit and run `yarn deploy:staging`. On the first
deploy there is no older commit with this script, so there is nothing to roll
back to except the old image tag.

Rollback does not revert SQLite schema changes already made on `/data`. A
failed Recreate rollout leaves the site down until the 10-minute
`rollout status` timeout, so watch `kubectl -n webapps get pods -w` in a
second terminal.

## Harbor trust (x509)

containerd on the node already trusts Harbor, so the cluster can pull. The
docker daemon the script pushes through must also trust it; if the push fails
with an `x509` error, install Harbor's CA for that daemon
(`/etc/docker/certs.d/registry.midnight.lan/ca.crt`). No docker restart is
needed. The script never uses `--insecure-registry`.
