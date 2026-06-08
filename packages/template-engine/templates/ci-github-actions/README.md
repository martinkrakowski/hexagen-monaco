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

Push to a feature branch → CI runs. Look for `# TODO` comments in the generated workflows for
the secrets each needs.

## Notes for agents

- Set `TURBO_TOKEN` (secret) + `TURBO_TEAM` (variable) for the remote cache — CI is much faster
  after the first run.
- The "Validate env vars" step runs `check:env` from [`env-setup`](../env-setup); delete it if
  env-setup isn't installed.
- Only the workflow for the chosen `deploy_target` is emitted.
- **Dependabot is tuned to avoid a first-publish PR flood.** Action bumps are
  grouped into one PR; npm minor+patch bumps are batched into one PR per
  dependency type (`production-dependencies`, `dev-dependencies`), while **major**
  bumps still arrive individually for careful review. To go quieter, switch the
  npm ecosystem to security-only by adding
  `open-pull-requests-limit: 0` (version updates off; security updates still
  open) — trades freshness for near-zero noise on a freshly scaffolded repo.

## Checklist (post-install)

Verify CI runs green; add the secrets flagged by `# TODO`; set Turbo cache vars; merge to main and
confirm deploy triggers; open a PR to test preview deploys; review Dependabot PRs.

## Related

Complements [`docker`](../docker) (image build) and [`env-setup`](../env-setup) (`check:env`).
