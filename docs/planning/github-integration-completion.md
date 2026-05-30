# GitHub Integration — Completion Plan

Status: **In progress** (Phase 0 shipped — PR #121; plan revised after architectural review)
Owner: Martin
Last updated: 2026-05-30

## Context

The repo contains **two** GitHub integrations built at different times:

### A. Live export path — _ships today, thin_

The "Push to GitHub" feature users actually hit:

| Layer    | File                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| UI       | `apps/web/features/export/ExportDialog.tsx`                                              |
| State    | `apps/web/app/contexts/ExportContext.tsx`                                                |
| Auth     | `apps/web/app/lib/auth.ts` (NextAuth GitHub provider, scope `read:user user:email repo`) |
| Route    | `apps/web/app/api/export/github/route.ts`                                                |
| Use case | `packages/project-generation/.../initiate-export.use-case.ts`                            |
| Adapter  | `packages/project-generation/.../github-exporter.adapter.ts` (raw `fetch` git-data API)  |

Wired end-to-end: OAuth → generate files → create repo → push.

### B. Hexagonal package — _unwired skeleton_ (`packages/external-integration`, "Wave 1B")

- Clean ports: `OAuthProviderPort`, `SessionReadPort`, `IVersionControlSystem.createPullRequest`.
- **No concrete OAuth/session adapters.**
- `GitHubVcsAdapter` is a stub: hardcoded `owner:"organization"`, `repo:"manifest-changes"`, never creates the branch/commit it opens a PR against — cannot work.
- `index.ts` doesn't export `infrastructure`, so the adapter is unreachable.
- Tests are mock-only; they assert nothing about real behavior.

## Bugs & gaps

1. **🔴 Empty-repo push bug.** Exporter creates repo with `auto_init:false` (no `main` ref) then `PATCH`es `/git/refs/heads/main` — updating a non-existent ref → 422. First push to a fresh repo fails. Needs create-vs-update ref logic.
2. **No tests** on `GitHubExporterAdapter`.
3. **Create-only.** No existing-repo, no branch targeting, force-updates `main`, no PR.
4. **Owner/visibility assumptions.** Owner = token login; no org support; `force:true` on `main` is destructive.
5. **Binary/large files & rate limits.** One blob per file via unbounded `Promise.all`.
6. **Token UX.** Expired/insufficient-scope tokens (401/403) surface as a blanket 500. No re-auth, no PAT fallback.
7. **Duplicate `github-provider` definitions** between the two packages.

## Architectural constraints (sources of truth)

Per `.architecture/contexts/`, the two packages sit in **different planes**:

- `project-generation` — `type: core`, `plane: core`
- `external-integration` — `type: supporting`, `plane: infrastructure`

`.architecture/invariants/linter-config.yaml` enforces that `project-generation` may import **only** `@hexagen/shared` and `@hexagen/sync`. So **`project-generation` cannot import `external-integration`** — the arch-linter would fail the build. The legal dependency direction is **infrastructure → core** (external-integration may depend on project-generation).

Background: ADR-0013 (`.architecture/decisions/ADR-0013-dual-export-paths.md`) introduced the dual archive/GitHub export directly in `project-generation` as a deliberate shortcut to ship the live path before the `external-integration` skeleton had real adapters. Reconciliation (Phase 4) returns the GitHub delivery mechanism to the infrastructure plane where it belongs.

## Strategy

Harden the live path now (it's what ships). Reconciliation moves the GitHub **delivery mechanism into `external-integration` (infrastructure)**, not the other way around: the `GitHubExporterAdapter` becomes an infrastructure adapter there, `external-integration` depends on `project-generation` to implement its `ProjectExporterPort`, and `wire.server.ts` (the app composition root) does the wiring. A shared `GitDataWriter` (blob/tree/commit/ref) lives in `external-integration` and backs both the exporter and the PR-creating VCS adapter.

## Phases

### Phase 0 — Bug fix + safety net ✅ shipped (PR #121, `f77ce052`)

1. ✅ Fix empty-repo ref bug: probe `refs/heads/<branch>` → `POST` create or `PATCH` update.
2. ✅ Integration tests for `GitHubExporterAdapter` against mocked `fetch`: fresh repo, existing branch, repo-already-exists, 401, missing-config; assert create→blob→tree→commit→ref sequence.
3. ⏳ **Deferred to Phase 1** (needs the structured-error change below): map GitHub error codes to precise HTTP statuses instead of blanket 500.

### Phase 1 — Push to existing repo / branch + structured errors

4. Extend `GitHubExportConfig` / `ExportIntent.repoConfig` with `targetBranch?` and `mode:"create"|"push"`.
5. **Non-destructive updates:** on push to an existing branch, fetch the head SHA, pass it as the commit's `parents`, and update the ref with **`force: false`** so prior history is never discarded and concurrent pushes fail loudly (no orphan commits). Create the branch ref off the base only when it's new.
6. **Structured error union** (carries over the deferred Phase 0 item 3): replace generic `Error` in the exporter/port with a typed union `{ code: "auth-failed" | "not-found" | "rate-limit" | "conflict" | "validation"; message }`. Map codes to HTTP statuses (401/404/429/409/422) in `route.ts`. (`GitHubApiError.status` added in Phase 0 is the seam to translate from.)
7. **Bounded blob concurrency:** replace the unbounded `Promise.all` over files with batches of ~5–10 to avoid GitHub secondary rate limits / socket exhaustion.
8. UI: create-new / push-to-existing choice + branch field in `ExportDialog`.

### Phase 2 — Open a pull request (revive hexagonal VCS port)

9. Real `GitHubVcsAdapter`: config-driven owner/repo/base/head (kill the hardcoded `"organization"/"manifest-changes"`); commit to head branch then `pulls.create`. Extract shared `GitDataWriter` (blob/tree/commit/ref) reused by the exporter + VCS adapter.
10. **Declare `@octokit/rest` in `external-integration/package.json`** — it is imported by `github-vcs.adapter.ts` but currently undeclared (resolves only via monorepo hoisting from `project-generation`). Required before this adapter is wired.
11. Export `infrastructure` from `external-integration/index.ts`.
12. Export-flow PR option: push to a feature branch + open PR; surface `prUrl`.

### Phase 3 — OAuth / token UX

13. On 401, signal the client to re-run `signIn("github")`; add a "re-connect GitHub" affordance.
14. Detect missing `repo` scope (403 on create) and message explicitly.
15. Optional PAT fallback behind a "use a token instead" toggle (`repoConfig.token` already supports it).
16. **Framework-agnostic boundary:** implement `OAuthProviderPort` / `SessionReadPort` against ports, but keep the **NextAuth-specific adapters in `apps/web`** (e.g. `apps/web/app/lib/adapters/`) and wire them to `external-integration`'s ports at the `wire.server.ts` composition root — do **not** add `next-auth` as a dependency of `external-integration`.

### Phase 4 — Reconciliation & cleanup

17. **Move `GitHubExporterAdapter` into `external-integration` (infrastructure plane)** backed by the shared `GitDataWriter`. `external-integration` depends on `project-generation` to implement its `ProjectExporterPort` (legal infra→core direction); `wire.server.ts` selects the adapter. Do **not** make `project-generation` import `external-integration` — the arch-linter forbids it (see Architectural constraints).
18. Collapse the duplicate `github-provider` value objects into one shared definition.
19. Delete/rewrite the placeholder mock-only `external-integration` tests.

## Sequencing

Phase 0 shipped (PR #121). Phase 1 delivers existing-repo/branch support plus the safety hardening (non-destructive parents, structured errors, bounded concurrency). Phase 2 adds PRs. Phase 3 covers OAuth/token UX. Phase 4 is the plane-realigning reconciliation and can trail.

## Reviewer corrections folded in (2026-05-30)

A structured critique flagged: (a) the original Phase 4 would violate the enforced `project-generation` import allow-list — **fixed** by inverting the dependency direction (adapter moves to infrastructure); (b) undeclared `@octokit/rest` in `external-integration` — **added** as Phase 2 step 10; (c) destructive `force:true` pushes — **fixed** in Phase 1 step 5 (`force:false` + parents); (d) NextAuth coupling into the package — **fixed** in Phase 3 step 16 (adapter lives in `apps/web`); (e) weak error types and unbounded concurrency — promoted to explicit Phase 1 steps 6–7.
