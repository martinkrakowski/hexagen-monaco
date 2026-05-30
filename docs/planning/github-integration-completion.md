# GitHub Integration — Completion Plan

Status: **In progress** (Phase 0 started on `feature/github-integration-completion`)
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

## Strategy

Harden the live path now (it's what ships), then grow it into `external-integration` so the two converge. New capabilities (existing-repo/branch, PR) land on the hexagonal `IVersionControlSystem` and a shared `GitDataWriter` helper reused by both the exporter and the VCS adapter.

## Phases

### Phase 0 — Bug fix + safety net

1. Fix empty-repo ref bug: detect `refs/heads/<branch>` → `POST` create or `PATCH` update; drop blind `force:true`.
2. Integration tests for `GitHubExporterAdapter` against mocked `fetch`: fresh repo, existing repo, repo-already-exists, 401, 403 rate-limit; assert create→blob→tree→commit→ref sequence.
3. Map GitHub error codes (401/403/409/422) to typed results so the route returns precise statuses, not 500.

### Phase 1 — Push to existing repo / branch

4. Extend `GitHubExportConfig` / `ExportIntent.repoConfig` with `targetBranch?` and `mode:"create"|"push"`.
5. On push to existing branch, fetch head SHA → set as commit `parents`; create branch ref off base when new.
6. UI: create-new / push-to-existing choice + branch field in `ExportDialog`.

### Phase 2 — Open a pull request (revive hexagonal VCS port)

7. Real `GitHubVcsAdapter`: config-driven owner/repo/base/head; commit to head branch then `pulls.create`. Extract shared `GitDataWriter` (blob/tree/commit) used by exporter + VCS adapter.
8. Export `infrastructure` from `external-integration/index.ts`.
9. Export flow PR option: push to feature branch + open PR; surface `prUrl`.

### Phase 3 — OAuth / token UX

10. On 401, signal client to re-run `signIn("github")`; add "re-connect GitHub" affordance.
11. Detect missing `repo` scope (403 on create) and message explicitly.
12. Optional PAT fallback behind a "use a token instead" toggle (`repoConfig.token` already supports it).
13. NextAuth-backed `SessionReadPort`/`OAuthProviderPort` adapters so `external-integration` owns auth.

### Phase 4 — Reconciliation & cleanup

14. Route `apps/web` through `external-integration`; reduce `project-generation` exporter to a thin caller of `GitDataWriter`.
15. Collapse duplicate `github-provider` value objects into one shared definition.
16. Delete/rewrite the placeholder mock-only `external-integration` tests.

## Sequencing

Phase 0 is a standalone PR worth shipping regardless (fixes an active user-facing failure). Phases 1–2 deliver new capabilities. Phase 3 covers OAuth/token UX. Phase 4 is the reconciliation payoff and can trail.
