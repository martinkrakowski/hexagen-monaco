# CI/CD Workflows

This directory contains three GitHub Actions workflows for the hexagen-monaco monorepo. Each reflects deliberate tradeoffs for a solo-developer project running on a resource-constrained VPS.

---

## `sync-integrity.yml` — Primary CI Pipeline

The main quality gate. Runs on every push and pull request.

**Pipeline order:** `build → sync → lint → test`

The sequence is intentional: `@hexagen/sync` must regenerate barrel files and port interfaces before the linter and arch-linter can validate them. Running lint before sync produces false positives against stale generated output. This is the workflow that enforces the `no-empty-stubs` invariant and architectural boundary rules defined in `generator.config.yaml` and `manifest.yaml`.

---

## `deploy.yml` — Production Deployment

Manual trigger only (`workflow_dispatch`). Builds a Docker image on the Actions runner, ships it to the VPS via SCP, and hot-swaps the running container.

**Why SCP instead of a registry?**

A private registry adds infrastructure overhead (authentication, storage costs, network routing) that isn't justified at this scale. Building on the runner and transferring the tarball is simpler, auditable, and avoids the registry as a dependency in the deployment path.

**Why `docker system prune -a -f --volumes`?**

This runs _after_ the new container is confirmed up. It is intentional and safe for the following reasons:

- The application is **stateless** — there are no database volumes or persistent data attached to any container.
- The VPS has a constrained memory profile (~7GB RAM). Leaving previous image layers and stopped containers resident would cause OOM conditions on the next deploy.
- Removing all unused layers maximises available swap for the running container.

If a stateful service (database, cache) is ever added, this line must be updated to use named volume exemptions (`--filter "label!=preserve"`).

**`AUTH_SECRET` handling:**

Written to `.env` on the VPS at deploy time via `echo "AUTH_SECRET=$AUTH_SECRET" > .env`. The value is sourced from GitHub repository secrets (`secrets.AUTH_SECRET`). The `.env` file is consumed by Docker Compose and is not committed to the repository.

---

## `publish.yml` — Package Publishing

Publishes updated workspace packages to npm on release.

**Known issue — `sleep 10`:**

After publishing a package, the workflow sleeps 10 seconds before dependent packages attempt to resolve it from the registry. This is a timing hack to account for npm propagation delay. It works in practice but is fragile under registry latency spikes.

The correct fix is a retry loop against the npm API (`npm view <package>@<version>`) before proceeding. This is tracked as a P2 remediation item.

---

## General Notes

**No Helm or Kustomize:**
The Kubernetes manifests in `k8s/` are bare YAML. At a single-replica deployment on a personal VPS, the operational overhead of a templating layer is not justified. The `harbor-regcred` secret name is hardcoded and documented here as a known coupling point.

**Playwright — Chromium only:**
The E2E suite targets Chromium. The application's primary users are on Chrome-based browsers. Cross-browser coverage will be added when cross-browser compatibility becomes an explicit requirement (though the application has been manually cross-browser tested).

**Pre-commit hooks are not run in CI:**
Husky hooks run locally on commit. CI enforces the same constraints independently via `sync-integrity.yml`. The pre-commit hook is being migrated to `lint-staged` to scope checks to staged files only and eliminate the 2–5 minute full-monorepo scan on every local commit.
