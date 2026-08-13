# Docker (`docker`)

> A multi-stage `Dockerfile`, `docker-compose` with optional peer services, a dev override for
> hot reload, and a GitHub Actions image-push workflow.

|               |                                     |
| ------------- | ----------------------------------- |
| **ID**        | `docker`                            |
| **Category**  | Infrastructure / deployment         |
| **Requires**  | —                                   |
| **Conflicts** | none                                |
| **Branch**    | `feature/generator-template-docker` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Containerises the app: a production multi-stage build, a Compose stack with profile-gated
backing services (Redis/Postgres/Mailhog/MinIO), a hot-reload dev override, and a CI workflow
that builds and pushes the image.

## What it scaffolds

`Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-compose.override.yml` (dev),
`docker-compose.ci.yml` (prod-equivalent), `.github/workflows/docker-build.yml`.

## Install

`hexagen add docker`. Questions:

| Question                 | Options (default)                               |
| ------------------------ | ----------------------------------------------- |
| `node_version`           | `20` / `22` / `23` (`22`)                       |
| `services` (multiselect) | `redis`, `postgres`, `mailhog`, `minio` (`[]`)  |
| `registry`               | `ghcr` / `ecr` / `docker-hub` / `none` (`ghcr`) |
| `health_path`            | `/` (use `/api/health` with `observability`)    |

## Usage

```bash
docker compose up --build                         # dev + hot reload (merges override)
COMPOSE_PROFILES=redis,postgres docker compose up  # enable backing services
docker compose -f docker-compose.yml -f docker-compose.ci.yml up --build   # prod-equivalent
```

## Notes for agents

- `docker-build.yml` starts **manual-only** (`workflow_dispatch`) so a fresh repo has zero
  failing checks — once `docker build .` works locally, uncomment its push/pull_request
  triggers (see the workflow's header comment).
- `ghcr.io` needs no extra secrets (uses `GITHUB_TOKEN`); Docker Hub/ECR require switching the
  commented login step in `docker-build.yml` and setting `REGISTRY_ORG`.
- The container health check probes `health_path` — point it at `/api/health` if `observability`
  is installed.
- Prerequisite for [`bedrock-agentcore-runtime`](../bedrock-agentcore-runtime) (ARM64 container).

## Checklist (post-install)

Create `.env.local`; `docker compose up --build`; enable services via `COMPOSE_PROFILES`; verify
the app + health path; for non-ghcr registries set `REGISTRY_ORG` and switch the login step.

## Related

Pairs with [`observability`](../observability) (health path) and [`ci-github-actions`](../ci-github-actions);
required by [`bedrock-agentcore-runtime`](../bedrock-agentcore-runtime).
