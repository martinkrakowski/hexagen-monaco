# Template: CI / GitHub Actions

**Branch:** `feature/generator-template-ci-github-actions`

## Purpose

Generates a complete, working CI/CD pipeline: build + typecheck + lint + test on every push, a separate deploy workflow per target, and an optional PR preview deploy. Configures caching correctly so cold runs are fast and warm runs are very fast. Designed to go green on first push.

---

## Install-Time Questions

| ID                | Prompt                       | Type        | Options                                                         | Default                          |
| ----------------- | ---------------------------- | ----------- | --------------------------------------------------------------- | -------------------------------- |
| `ci_triggers`     | When should CI run?          | multiselect | `push-all-branches`, `push-main-only`, `pull-request`, `manual` | `push-all-branches,pull-request` |
| `deploy_target`   | Deploy target?               | select      | `vercel`, `railway`, `fly-io`, `vps-ssh`, `none`                | `vercel`                         |
| `preview_deploys` | PR preview deploys?          | boolean     | —                                                               | `true` (if vercel/railway)       |
| `node_version`    | Node.js version?             | select      | `20`, `22`, `23`                                                | `22`                             |
| `package_manager` | Package manager?             | auto        | _(from project)_                                                | `yarn`                           |
| `docker_build`    | Build and push Docker image? | boolean     | — (only if docker template installed)                           | `true`                           |
| `run_tests`       | Run tests in CI?             | boolean     | —                                                               | `true`                           |
| `cache_strategy`  | Dependency cache strategy?   | select      | `node-modules`, `yarn-cache`, `turbo-cache`                     | `turbo-cache`                    |

---

## Files Generated

```
.github/
  workflows/
    ci.yml                   # Build + typecheck + lint + test
    deploy.yml               # Deploy to production on main merge
    preview.yml              # PR preview deploy (if enabled)
    docker-build.yml         # Docker build + push (if docker template installed)
  dependabot.yml             # Auto-update GitHub Actions versions
```

---

## Key Design Decisions

**Turbo cache is the primary cache strategy:** The `turbo.json` remote cache (GitHub Actions cache backend) caches task outputs by input hash. A push that only changes `app/` won't rebuild `packages/` — Turbo skips it. This is dramatically faster than just caching `node_modules`.

**Separate `ci.yml` and `deploy.yml`:** CI runs on every push (fast feedback). Deployment runs only on `main` merge (intentional). These are separate workflows, not jobs in the same workflow — deploy can be re-run without re-running tests.

**Env secrets are injected at job level:** No hardcoded values; no `.env` files in CI. Variables are injected from GitHub Secrets/Variables using `env:` at the job level. The generated workflow includes `# TODO: add X_SECRET to repo secrets` comments for every required secret.

**`check-env` is the first CI step:** Before building anything, `yarn check:env` validates that all required secrets are present in CI. This produces a clear failure message if a secret is missing rather than a cryptic build failure 3 minutes later.

**Dependabot keeps Actions versions up-to-date:** A `dependabot.yml` with `package-ecosystem: github-actions` is always generated. GitHub supply chain attacks via stale Actions versions are a real risk.

---

## Phase 1 — CI Workflow

**Goal:** Fast, reliable CI that runs on every push and PR.

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]

jobs:
  ci:
    name: Build, Typecheck, Lint & Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "yarn"

      - name: Install dependencies
        run: yarn install --immutable

      - name: Restore Turbo cache
        uses: actions/cache@v4
        with:
          path: .turbo
          key: ${{ runner.os }}-turbo-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-turbo-

      - name: Validate env vars
        run: yarn check:env
        env:
          # Non-secret defaults for CI validation
          NODE_ENV: test
          AUTH_MODE: mock
          BULLMQ_FALLBACK_MODE: always

      - name: Build
        run: yarn build
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}

      - name: Typecheck
        run: yarn typecheck

      - name: Lint
        run: yarn lint

      - name: Test
        run: yarn test
        env:
          NODE_ENV: test
```

Validation: Push to a feature branch; assert all steps pass in under 3 minutes on a warm cache.

---

## Phase 2 — Vercel Deploy Workflow

**Goal:** Automatic production deploy on `main` merge.

`.github/workflows/deploy.yml` (Vercel variant):

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]

jobs:
  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "yarn"

      - run: yarn install --immutable

      - name: Deploy to Vercel
        run: |
          npx vercel deploy \
            --token=${{ secrets.VERCEL_TOKEN }} \
            --prod \
            --yes \
            --env XAI_API_KEY=${{ secrets.XAI_API_KEY }} \
            --env SUPABASE_SERVICE_ROLE_KEY=${{ secrets.SUPABASE_SERVICE_ROLE_KEY }} \
            --env AUTH_SESSION_SECRET=${{ secrets.AUTH_SESSION_SECRET }}
```

Comment in generated file:

```yaml
# TODO: Add these secrets to GitHub repo → Settings → Secrets and variables → Actions:
# - VERCEL_TOKEN (from vercel.com → Settings → Tokens)
# - XAI_API_KEY
# - SUPABASE_SERVICE_ROLE_KEY
# - AUTH_SESSION_SECRET
```

Validation: Merge to `main`; assert Vercel deployment succeeds and `/api/health` returns 200.

---

## Phase 3 — Railway Deploy Workflow (alt)

**Goal:** Automatic deploy to Railway (alternative to Vercel for full-stack or worker-heavy projects).

`.github/workflows/deploy.yml` (Railway variant):

```yaml
- name: Deploy to Railway
  uses: bervProject/railway-deploy@main
  with:
    railway_token: ${{ secrets.RAILWAY_TOKEN }}
    service: ${{ vars.RAILWAY_SERVICE }}
```

Railway advantage: supports background worker services natively alongside the web service. Generated when `deploy_target=railway` AND `bullmq` with `worker_mode=separate-service` is installed.

Validation: Merge to `main`; assert Railway redeploys both `web` and `worker` services.

---

## Phase 4 — PR Preview Deploys

**Goal:** Automatic preview URL on every PR.

`.github/workflows/preview.yml` (Vercel variant):

```yaml
name: Preview Deploy

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - run: yarn install --immutable

      - name: Deploy Preview
        id: deploy
        run: |
          PREVIEW_URL=$(npx vercel deploy \
            --token=${{ secrets.VERCEL_TOKEN }} \
            --yes 2>&1 | tail -1)
          echo "url=$PREVIEW_URL" >> $GITHUB_OUTPUT

      - name: Comment Preview URL
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `🚀 Preview: ${{ steps.deploy.outputs.url }}`
            });
```

Validation: Open a PR; assert preview URL comment appears within 2 minutes.

---

## Phase 5 — Docker Build & Push (auto if docker template installed)

See `08-docker.md` Phase 5 — this workflow is merged into `docker-build.yml` which is generated by the Docker template. The CI template adds a `needs: ci` dependency to the Docker build job so images are only pushed when CI passes.

---

## Phase 6 — Fly.io Deploy Workflow (alt)

**Goal:** Deploy to Fly.io for projects needing persistent connections or WebSockets.

```yaml
- name: Deploy to Fly.io
  uses: superfly/flyctl-actions/setup-flyctl@master
- run: flyctl deploy --remote-only
  env:
    FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

`fly.toml` stub is also generated with correct `app`, `primary_region`, and `[http_service]` config.

Validation: `flyctl deploy` succeeds; `fly status` shows running instance.

---

## Phase 7 — VPS SSH Deploy (alt)

**Goal:** Deploy to a plain VPS via SSH + rsync for minimal infrastructure.

```yaml
- name: Deploy via SSH
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.VPS_HOST }}
    username: ${{ secrets.VPS_USER }}
    key: ${{ secrets.VPS_SSH_KEY }}
    script: |
      cd ~/app
      git pull origin main
      yarn install --immutable
      yarn build
      pm2 restart app
```

Validation: Push to `main`; SSH into VPS; assert `pm2 status` shows updated instance.

---

## Phase 8 — Dependabot

**Goal:** Auto-update GitHub Actions versions to prevent supply chain attacks.

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5

  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dev-dependencies:
        patterns: ["*"]
        dependency-type: development
    open-pull-requests-limit: 5
```

Validation: Dependabot PRs appear within one week of template installation.

---

## Post-Install Checklist

```
✅ ci-github-actions installed

Next steps:
  1. Push to a feature branch and verify CI workflow runs green
  2. Add required secrets: GitHub repo → Settings → Secrets and variables → Actions
     (Look for # TODO comments in the generated workflow files)
  3. Set TURBO_TOKEN and TURBO_TEAM for remote Turbo cache (faster CI after first run)
  4. Merge to main and verify deploy workflow triggers
  5. Open a PR and verify preview URL comment appears (if preview deploys enabled)
  6. See SETUP.md → CI/CD for secret setup walkthrough per deploy target
```

---

## Template Dependencies

- Soft dependency: `env-setup` (the `check:env` CI step runs only if the script exists, so CI stays green without it; reclassified from Required in Item 2 of the installable-scaffold plan)
- Integrates with: `docker` (adds `needs: ci` to docker-build.yml)
- Integrates with: `bullmq` (generates worker service deploy in Railway mode)
- Soft dependency: `observability` (health check is used in deploy smoke test)
