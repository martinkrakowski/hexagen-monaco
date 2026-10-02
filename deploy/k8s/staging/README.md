# Staging deploy (k3s on midnight)

`yarn deploy:staging` builds the web app image from the tracked files at `HEAD`,
pushes it to Harbor, and updates `deployment/hexagen-web` in namespace
`webapps`, served at `https://hexagen.midnight.lan`. It is separate from the VPS
deploy (`scripts/deploy.sh`), which it never calls.

## What the script does

1. Refuses a dirty tree; the tag is `git rev-parse --short HEAD`.
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

Required keys (the script refuses to deploy without them):

- Auth: `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`. The app reads
  `NEXTAUTH_SECRET` only (NextAuth v4), so `AUTH_SECRET` alone is not enough.
- LLM: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `WEB_LLM_API_KEY`,
  `INCEPTION_API_KEY`, `INCEPTION_MODEL`.
- Stripe (test mode): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_REPO_MONTHLY`.

Optional: `LLM_REASONING`, `STAGE1_REFINER_*`, `STAGE6_REVIEWER_*`. Leaving the
refiner and reviewer keys unset turns those stages off. See `deploy/.env.example`.

The GitHub OAuth App's callback URL must be
`https://hexagen.midnight.lan/api/auth/callback/github`.

## State

The three SQLite files (`quota.db`, `byok.db`, `platform.db`) live on PVC
`hexagen-web-data` (1Gi, local-path, ReadWriteOnce) mounted at `/data`.
local-path creates the directory root-owned with mode 0777 (its setup script
runs `mkdir -m 0777`), so the pod runs fully non-root as uid 1001 with no
initContainer. If the provisioner's setup script is ever changed to a stricter
mode, add a root initContainer limited to `chown 1001:1001 /data`.

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

- Replicas go from 2 to 1 and the strategy becomes `Recreate`, so there is a
  short downtime on every deploy (one writer on the SQLite volume).
- The PVC starts empty: accounts, projects and quotas start fresh.
- Harbor must be reachable from the midnight docker daemon (below).

## Roll back

Check out an older commit and run `yarn deploy:staging` again. It rebuilds that
commit's image under its own tag and applies it.

## Harbor trust (x509)

If the push fails with an `x509` error, the docker daemon on midnight does not
trust Harbor's certificate. Install Harbor's CA on midnight for the daemon
(`/etc/docker/certs.d/registry.midnight.lan/ca.crt`, then restart docker). The
script never uses `--insecure-registry`.
