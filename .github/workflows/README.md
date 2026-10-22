# CI/CD Workflows

GitHub Actions workflows for the hexagen-monaco monorepo. Each reflects deliberate tradeoffs for a solo-developer project running on a resource-constrained VPS.

---

## `pr-agent.yml` — UI-contract LLM review

Not a merge gate. Posts a DESIGN.md-focused review on PR `opened` / `reopened` / `ready_for_review`, and on slash commands (`/review`, `/ask`, …) via `issue_comment` **created** by `OWNER` / `MEMBER` / `COLLABORATOR`. Complements CodeRabbit and Qodo; `auto_describe` and `auto_improve` are off. Draft PRs skip the auto-run; a trusted `/review` on a draft is the explicit override.

**Secret:** `OPENROUTER_KEY` (repo Actions secret). The workflow maps it to `OPENROUTER__KEY` (`[openrouter].key`). `GITHUB_TOKEN` is the default Actions token.

**Pin:** `docker://pragent/pr-agent@sha256:b81235c3bddc551939a1feca8926f4b6e8abcec2ae5bf4620424f8f56dd9cb93` (`0.42.0-github_action` index digest). Do not switch to `the-pr-agent/pr-agent@<sha>` — that action's Dockerfile `FROM`s the rolling `:github_action` tag.

**Config:** `.pr_agent.toml` at the repo root, read from the **default branch**. Missing `repo_context_files` entries are skipped, not a crash. `repo_context_from_default_branch = false` reads the PR **target** branch, not the PR head — do not use it as a bootstrap. The workflow `env` block is the live GHA contract (model, context list, max lines, extra_instructions) and must stay in agreement with toml. Context files: `.agents/PR_REVIEW_RUBRIC.md`, `best_practices.md`, `DESIGN.md`.

**Permissions:** `contents: read`, `pull-requests: write`, `issues: write`, with `config.restricted_mode = true`. No `pull_request_target`.

---

## `pr-agent-correctness.yml` — correctness LLM review

Not a merge gate. A second PR-Agent reviewer beside the UI one, for the whole repository: tenant and author scope on store calls, what can commit between a route's check and the store's write, deletion and its cascades, input that fails open, swallowed errors, tests that assert less than their name, secrets in logs, manifests and workflows. Runs once per pull request on `opened` / `reopened` / `ready_for_review`; drafts are skipped; there are no slash commands on this workflow.

**Tool:** PR-Agent's `/review`, each finding a line comment, at most twelve. Not `/improve`: its second model call scores every suggestion and drops one that scores 0, and was seen to drop a real defect. A guard step fails the check unless `/review` left its own comment ("PR Reviewer Guide") in the run.

**Models:** every pull request is reviewed by `openrouter/openai/gpt-6.1-sol`; fallback `openrouter/openai/gpt-6-luna`. The step summary names the model. Until 2026-10-10 odd-numbered pull requests went to a Claude model as a comparison; that ended with the owner's rule that no Claude, Gemini or Grok model runs through OpenRouter in a pipeline seat.

**Config:** everything lives in the workflow's `env` block. `.pr_agent.toml` is the UI reviewer's and is still read (from the default branch) for anything the env block does not set; in particular the env block clears the toml's `[ignore].regex`, which would otherwise hide every file outside `apps/web`.

**Secret and pin:** the same `OPENROUTER_KEY` as `pr-agent.yml`; the `0.47.0-github_action` digest, ahead of the UI reviewer's `0.42.0` (line comments from `/review` need the later version). The UI reviewer's upgrade is a change of its own.

---

## `sync-integrity.yml` — Primary CI Pipeline

The main quality gate. Runs on every push and pull request.

**Pipeline order:** `build → sync → lint → test`

The sequence is intentional: `@hexagen/sync` must regenerate barrel files and port interfaces before the linter and arch-linter can validate them. Running lint before sync produces false positives against stale generated output. This is the workflow that enforces the `no-empty-stubs` invariant and architectural boundary rules defined in `generator.config.yaml` and `manifest.yaml`.

---

## Production deployment (no workflow here)

Production runs on the OCI k3s cluster and is deployed by Flux from the
`martinkrakowski/platform` repository (`apps/production/hexagen-web`).
`build-image.yml` builds, signs and pushes the multi-arch image to GHCR; a
platform pull request moves the pinned digest. Nothing in this repository
reaches production. The old `deploy.yml` (SCP to the droplet) was removed on
2026-10-21 after the cutover to OCI.

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
