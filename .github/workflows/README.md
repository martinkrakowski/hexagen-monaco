# CI/CD Workflows

GitHub Actions workflows for the hexagen-monaco monorepo. Each reflects deliberate tradeoffs for a solo-developer project running on a resource-constrained VPS.

---

## `pr-agent.yml` — UI-contract LLM review

Not a merge gate. Posts a DESIGN.md-focused review on PR `opened` / `reopened` / `ready_for_review`, and on `/review` (and other slash commands) via `issue_comment`. Complements CodeRabbit and Qodo; `auto_describe` and `auto_improve` are off.

**Secret:** `OPENROUTER_KEY` (repo Actions secret). The workflow maps it to `OPENROUTER__KEY` (`[openrouter].key`). `GITHUB_TOKEN` is the default Actions token.

**Pin:** `docker://pragent/pr-agent@sha256:b81235c3bddc551939a1feca8926f4b6e8abcec2ae5bf4620424f8f56dd9cb93` (`0.42.0-github_action` index digest). Do not switch to `the-pr-agent/pr-agent@<sha>` — that action's Dockerfile `FROM`s the rolling `:github_action` tag.

**Config:** `.pr_agent.toml` at the repo root, read from the **default branch**. Missing `repo_context_files` entries are skipped, not a crash. `repo_context_from_default_branch = false` reads the PR **target** branch, not the PR head — do not use it as a bootstrap. The workflow `env` block is the live GHA contract (model, context list, max lines, extra_instructions) and must stay in agreement with toml. Context files: `.agents/PR_REVIEW_RUBRIC.md`, `best_practices.md`, `DESIGN.md`.

**Permissions:** `contents: read`, `pull-requests: write`, `issues: write`, with `config.restricted_mode = true`. No `pull_request_target`.

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

**Runtime env / secret handling:**

At deploy time the SSH step writes a multi-line `.env` heredoc to `/opt/hexagen-monaco/.env`, consumed by Docker Compose and never committed:

```
NEXTAUTH_URL=...        # canonical prod URL (hardcoded in the workflow env)
NEXTAUTH_SECRET=...      # = AUTH_SECRET (NextAuth reads NEXTAUTH_SECRET)
AUTH_SECRET=...          # kept for back-compat
GITHUB_ID / GITHUB_SECRET  # GitHub OAuth App client id/secret
LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
```

Values are sourced from GitHub repository secrets and mapped into the runner via the step's `env:` block, then forwarded to the remote shell through the action's `envs:` list (without that mapping the forwarded values would be empty).

Two naming details worth knowing:

- **`NEXTAUTH_SECRET` vs `AUTH_SECRET`** — the app reads `NEXTAUTH_SECRET` (NextAuth default + `getToken()` in the push/export routes); the heredoc writes it from the existing `AUTH_SECRET` secret.
- **`GH_OAUTH_ID` / `GH_OAUTH_SECRET`** — GitHub forbids repository secrets with a `GITHUB_` prefix, so the OAuth credentials are stored under these names and rewritten to `GITHUB_ID` / `GITHUB_SECRET` in the `.env`.

> **Container caveat:** the `.env` only reaches the container if the VPS `docker-compose.yml` web service declares `env_file: [.env]` (or an explicit `environment:` block). A project-level `.env` is otherwise used only for `${VAR}` interpolation, not injected as container environment. See [`docs/planning/managed-deploy-compose.md`](../../docs/planning/managed-deploy-compose.md).

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
Husky hooks run locally on commit. CI enforces the same constraints independently via `sync-integrity.yml`. The pre-commit hook is being migrated to `lint-staged` to scope checks to staged files only and eliminate the full-monorepo scan on every local commit.
