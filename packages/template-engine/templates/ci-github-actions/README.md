# CI / GitHub Actions (`ci-github-actions`)

> GitHub Actions CI (build / typecheck / lint / test) with Turbo cache, a per-target deploy
> workflow, optional PR preview deploys, and Dependabot.

|               |                                                |
| ------------- | ---------------------------------------------- |
| **ID**        | `ci-github-actions`                            |
| **Category**  | Infrastructure / CI-CD                         |
| **Requires**  | —                                              |
| **Conflicts** | none                                           |
| **Branch**    | `feature/generator-template-ci-github-actions` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Generates a CI workflow plus exactly one deploy workflow for your chosen target
(Vercel/Railway/Fly.io/VPS), optional preview deploys, and Dependabot — all wired for the Turbo
remote cache.

## What it scaffolds

`.github/workflows/ci.yml`, `.github/dependabot.yml`, and a gated deploy workflow per
`deploy_target` (`deploy-vercel.yml` / `deploy-railway.yml` / `deploy-fly.yml` + `fly.toml` /
`deploy-vps.yml`), plus `preview.yml` when preview deploys are on.

## Install

`hexagen add ci-github-actions`. Questions:

| Question                    | Options (default)                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ci_triggers` (multiselect) | `push-all-branches`, `push-main-only`, `pull-request`, `manual` (`[push-all-branches, pull-request]`) |
| `deploy_target`             | `vercel` / `railway` / `fly-io` / `vps-ssh` / `none` (`vercel`)                                       |
| `preview_deploys`           | `true`                                                                                                |
| `node_version`              | `20` / `22` / `23` (`22`)                                                                             |
| `docker_build`              | `false` (the `docker` template owns `docker-build.yml`)                                               |
| `run_tests`                 | `true`                                                                                                |
| `cache_strategy`            | `node-modules` / `yarn-cache` / `turbo-cache` (`turbo-cache`)                                         |

## Usage

Push to a feature branch → CI runs. Deploy workflows start **manual-only**
(`workflow_dispatch`) and the preview job is gated on the `ENABLE_PREVIEW_DEPLOYS` repository
variable, so a freshly pushed repo has zero failing checks — each generated workflow's header
comment lists the secrets it needs and how to switch on automatic triggers.

## Notes for agents

- Set `TURBO_TOKEN` (secret) + `TURBO_TEAM` (variable) for the remote cache — CI is much faster
  after the first run.
- The "Validate env vars" step runs `check:env` from [`env-setup`](../env-setup); delete it if
  env-setup isn't installed.
- Only the workflow for the chosen `deploy_target` is emitted.
- **Dependabot is tuned to avoid a first-publish PR flood.** Action bumps are
  grouped into one PR; npm minor+patch bumps are batched into one PR per
  dependency type (`production-dependencies`, `dev-dependencies`), and **major**
  npm bumps are **ignored** outright (an `ignore` block on
  `version-update:semver-major`) — a fresh repo is a major behind on several
  deps at once. Delete the ignore block when you're ready to review majors one
  at a time; security advisories open PRs regardless. To go quieter still, make
  the npm ecosystem security-only: change the npm entry's existing
  `open-pull-requests-limit: 5` to `0` (version updates off; security updates
  still open) — trades freshness for near-zero noise on a freshly scaffolded repo.

## Checklist (post-install)

Verify CI runs green; add the secrets listed in each workflow's header comment; set Turbo cache
vars; uncomment the deploy workflow's push trigger and confirm it runs on merge to main; set
`ENABLE_PREVIEW_DEPLOYS=true` and open a PR to test preview deploys; review Dependabot PRs.

## Related

Complements [`docker`](../docker) (image build) and [`env-setup`](../env-setup) (`check:env`).
