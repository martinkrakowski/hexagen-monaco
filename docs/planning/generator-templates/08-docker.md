# Template: Docker

**Branch:** `feature/generator-template-docker`

## Purpose

Generates a production-ready multi-stage Dockerfile, docker-compose for local development (app + dependencies), override file for dev-mode hot reload, `.dockerignore`, and a GitHub Actions workflow for Docker image build and push. Enables consistent local dev environments and a clear path to any container-based deployment.

---

## Install-Time Questions

| ID                | Prompt                                 | Type        | Options                                                   | Default                          |
| ----------------- | -------------------------------------- | ----------- | --------------------------------------------------------- | -------------------------------- |
| `node_version`    | Node.js version?                       | select      | `20`, `22`, `23`                                          | `22`                             |
| `package_manager` | Package manager?                       | select      | `yarn`, `pnpm`, `bun`, `npm`                              | `yarn`                           |
| `services`        | Additional services in docker-compose? | multiselect | `redis`, `postgres`, `supabase-local`, `mailhog`, `minio` | _(based on installed templates)_ |
| `registry`        | Container registry?                    | select      | `ghcr`, `ecr`, `docker-hub`, `none`                       | `ghcr`                           |
| `registry_org`    | Registry org / username?               | text        | —                                                         | _(required if registry != none)_ |
| `port`            | App port?                              | text        | —                                                         | `3000`                           |
| `health_check`    | Include health check in Dockerfile?    | boolean     | —                                                         | `true`                           |
| `worker_service`  | Separate worker service in compose?    | boolean     | — (only if bullmq installed)                              | `true`                           |

---

## Files Generated

```
Dockerfile
.dockerignore
docker-compose.yml
docker-compose.override.yml     # Dev overrides (hot reload, exposed ports)
docker-compose.ci.yml           # CI overrides (no volumes, deterministic)

.github/
  workflows/
    docker-build.yml            # Build + push to registry on main merge

scripts/
  docker-healthcheck.sh         # Used by HEALTHCHECK in Dockerfile
```

---

## Key Design Decisions

**Multi-stage Dockerfile:** `base` → `deps` (install only prod deps) → `builder` (compile TypeScript) → `runner` (minimal image, no devDependencies, no source). Reduces image size by 60–70% vs single-stage.

**`docker-compose.override.yml` is the dev file:** Base `docker-compose.yml` describes the production-equivalent service topology. `override.yml` mounts the source directory for hot reload and exposes debug ports. Running `docker compose up` (no flags) merges both automatically.

**`docker-compose.ci.yml` is for CI:** Overrides the override — removes volume mounts and sets `restart: no`. Used as `docker compose -f docker-compose.yml -f docker-compose.ci.yml up --build` in CI.

**Auto-detection of services:** If `redis` template is installed, Redis service is added automatically. If `supabase` is installed, `supabase-local` option surfaces. This prevents compose files that reference services not installed.

**Worker service:** When BullMQ is installed with `worker_mode=separate-service`, `docker-compose.yml` includes a `worker` service using the same image with a different `CMD`.

**Health check is a shell script:** `HEALTHCHECK CMD ./scripts/docker-healthcheck.sh` — this calls `GET /api/health` and checks for HTTP 200. Defined as an external script (not inline) so it can be tested independently.

---

## Phase 1 — Dockerfile (Multi-Stage)

**Goal:** Production image under 300MB for a typical Next.js app.

```dockerfile
# Stage 1: base
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare yarn@stable --activate
WORKDIR /app

# Stage 2: deps — install production dependencies
FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
RUN yarn workspaces focus --all --production

# Stage 3: builder — compile TypeScript
FROM base AS builder
COPY . .
RUN yarn install --immutable
RUN yarn build

# Stage 4: runner — minimal production image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"
CMD ["yarn", "start"]
```

Validation: `docker build -t app-test .` succeeds; `docker run -p 3000:3000 app-test` serves the app.

---

## Phase 2 — .dockerignore

**Goal:** Exclude build artifacts, secrets, and dev files from the image context.

```
node_modules
.next
.git
.env*
!.env.example
coverage
dist
*.md
.turbo
docs
```

Validation: `docker build` context size is under 50MB (varies by project).

---

## Phase 3 — docker-compose.yml (Base)

**Goal:** Production-equivalent service topology for local dev.

```yaml
version: "3.9"
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: [.env.local]
    depends_on:
      redis: { condition: service_healthy } # if redis selected
      postgres: { condition: service_healthy } # if postgres selected
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get(...)"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis: # if redis selected
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s

  postgres: # if postgres selected
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 10s

  worker: # if bullmq + worker_mode=separate-service
    build: .
    command: node --import tsx/esm scripts/start-worker.ts
    env_file: [.env.local]
    depends_on: [redis]

  mailhog: # if mailhog selected
    image: mailhog/mailhog
    ports: ["1025:1025", "8025:8025"]

volumes:
  pgdata:
```

Validation: `docker compose config` parses without errors.

---

## Phase 4 — docker-compose.override.yml (Dev)

**Goal:** Hot reload and exposed debug ports for local development.

```yaml
version: "3.9"
services:
  app:
    build:
      context: .
      target: builder # Stop at builder stage — includes devDependencies
    command: yarn dev
    volumes:
      - .:/app
      - /app/node_modules # Don't override container's node_modules
      - /app/.next
    environment:
      NODE_ENV: development
```

Validation: `docker compose up` (merges base + override) starts the app in dev mode with hot reload.

---

## Phase 5 — GitHub Actions: Docker Build & Push

**Goal:** Automated image build and push to the selected registry on every merge to `main`.

`.github/workflows/docker-build.yml`:

```yaml
name: Docker Build & Push
on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=sha-
            type=ref,event=branch
            latest
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Validation: Push to `main` triggers workflow; image appears in registry.

---

## Post-Install Checklist

```
✅ docker installed

Next steps:
  1. docker compose up --build   (starts app + all services)
  2. Verify app at http://localhost:3000/api/health
  3. Set REGISTRY_ORG in .env for GitHub Actions image naming
  4. Add GITHUB_TOKEN to repo secrets if using a private registry
  5. In separate-worker mode: worker service starts alongside app automatically
  6. See SETUP.md → Docker for registry setup and deployment target instructions
```

---

## Template Dependencies

- Auto-adds `redis` service when `rate-limiting` template has Redis mode enabled
- Auto-adds `redis` service when `bullmq` template is installed
- Auto-adds `postgres` service when `supabase` template is installed with Drizzle
- Soft dependency: `observability` (health check route must exist before Dockerfile HEALTHCHECK works)
- Integrates with: `ci-github-actions` (docker-build.yml is merged into combined CI workflow)
