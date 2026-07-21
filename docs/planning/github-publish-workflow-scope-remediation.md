# GitHub Publish 404 — `workflow` Scope Remediation Plan

**Status:** PLANNED (no work started)
**Date:** 2026-07-06
**Owner:** Martin
**Related:** PR #330 (sync-integrity workflow re-wire), memory `github_publish_workflow_scope_404`

## 1. Problem

"Push to GitHub" (wizard summary, project menu, export dialog) fails with:

```
Publish failed
GitHub API error (404): {"message":"Not Found","documentation_url":"https://docs.github.com/rest/git/trees#create-a-tree","status":"404"}
```

### Root cause (empirically proven, deterministic repro)

- GitHub rejects `POST /repos/{owner}/{repo}/git/trees` with a bare **404 "Not Found"**
  when the tree contains any `.github/workflows/*` path and the token lacks the
  **`workflow` OAuth scope**. The identical tree with the file at any other path
  returns 201. (All other failure classes were ruled out by probe: empty tree /
  bad sha / bad mode / malformed path → 422; empty repo → 409; no push access →
  404 **at the blobs step first**, distinguishable by the `git/blobs` doc URL.)
- The app's NextAuth GitHub provider requests only `read:user user:email repo`
  (`apps/web/app/lib/auth.ts` — `authOptions` → GitHubProvider scope string).
- PR #330 (merged 2026-06-13) re-wired the sync-integrity auto-inject: every
  generated project whose manifest packageManager is yarn (**the wizard
  default**; gate `shouldInjectSyncIntegrityWorkflow`, pnpm/bun exempt) ships
  `.github/workflows/sync-integrity.yml`
  (`packages/project-generation/src/domain/sync-integrity-workflow.ts`).

Net effect: **every OAuth scaffold publish of a yarn project has failed since
#330 reached prod.** The repro harness (run `InitiateExportUseCase` +
`GitHubExporterAdapter` via `yarn tsx` from `apps/web/` with `gh auth token`,
fetch monkey-patched for per-call logging) reproduced the exact error: repo
created, 32/32 blobs 201, tree POST 404.

### Affected paths

| Path                                                                           | Effect                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Scaffold publish — `/api/export/github` → `GitHubExporterAdapter.export`       | **Broken** for yarn projects (default)                                            |
| Editor push — `/api/push/github` → `GitHubRepositoryWriterAdapter.commitFiles` | Latent: fails the same way iff the pushed file set includes `.github/workflows/*` |
| ZIP export                                                                     | Unaffected (no GitHub API)                                                        |
| pnpm/bun projects                                                              | Unaffected (no workflow injected)                                                 |

## 2. Goals

1. Publishes succeed again for **existing sessions** (old tokens, no re-auth) — degraded but truthful.
2. New sign-ins get the `workflow` scope so published projects include the CI workflow (restores #330's intent end-to-end).
3. No path ever surfaces the opaque 404 again — every failure names the remedy.
4. Regression coverage so a future injected `.github/workflows/**` file can't silently re-break publish.

## 3. Design decisions

**D1 — Scaffold publish with a scope-less token: degrade, don't fail (recommended).**
Strip `.github/workflows/*` from the exported tree, push the rest, and surface a
warning ("CI workflow skipped — reconnect GitHub to include it"). Rationale:
the user's primary intent is "my project on GitHub"; the workflow is an
enhancement. Alternative (rejected): hard-fail demanding re-auth — worse
first-run UX, and pre-#330 publishes shipped no workflow anyway.

**D2 — Editor push with a scope-less token: fail with an actionable error.**
Here the user explicitly chose files; silently dropping one is a lie. Error:
"GitHub blocked pushing `.github/workflows/…` — reconnect GitHub to grant
workflow permission." No stripping.

**D3 — Scope detection: proactive header check, fail-open, plus reactive 404 remap.**
`x-oauth-scopes` response header (verified present for the app's OAuth tokens;
exposed via CORS allowlist too). Parse from the existing `GET /user` call in the
exporter; add a tiny helper for `commitFiles`. If the header is absent (e.g. a
future GitHub-App-token migration), treat scopes as unknown and proceed
unchanged — the **reactive remap** then catches it: when `createTree` returns
404 and the `tree` argument that was submitted to it contains any entry whose
`path` starts with `.github/workflows/`, remap to the actionable message
instead of the raw GitHub JSON. Key point: the GitHub 404 response body does
not echo the submitted paths (`GitHubApiError` carries only `status` and
`message`), so the remap condition is checked against the **caller's local
`tree` array**, not the error payload.

**D4 — Request `workflow` scope at sign-in.**
`scope: "read:user user:email repo workflow"` in `authOptions`. Classic OAuth
scope; no GitHub OAuth-app config change needed (scopes are request-time).
Existing JWTs keep the old token — the jwt callback only refreshes
`accessToken` on a new sign-in — so D1–D3 remain necessary, not transitional
niceties. A "Reconnect GitHub" affordance calling `signIn("github")` upgrades
the token without sign-out.

**D5 — Warning plumbing reuses the existing notices channel.**
`ExportResult` (project-exporter port) gains `warnings?: string[]`;
`GenerateProjectUseCase.execute` appends exporter warnings to the output
warnings it already returns; `/api/export/github` already forwards
`result.value.warnings`; the client already renders notice counts on the
success state. No repo-side sidecar file (unlike add-on notices) — decision
open to revisit, see §8/Q3.

## 4. Workstreams

### PR-1 — Server resilience (ship first; restores publish for everyone, no re-auth needed)

`packages/external-integration`:

- `github-git-data.client.ts`
  - `getTokenScopes(token): Promise<Set<string> | null>` — `GET /user`, parse
    `x-oauth-scopes` (comma+space separated); `null` = unknown (fail-open).
  - `createTree` (or its call sites): on 404 where the submitted tree contained
    a `.github/workflows/` path, throw a remapped `GitHubApiError` with
    actionable text (mention `workflow` scope + reconnect). Keep status 404 so
    route mapping stays honest; message carries the remedy.
- `github-exporter.adapter.ts`
  - Reuse the existing `GET /user` (`getAuthenticatedLogin`) response to capture
    scopes — avoid a second round-trip.
  - When scopes are known and lack `workflow`: filter `.github/workflows/*` out
    of the file list before blob creation (don't waste the blob calls), record
    one warning per skipped file, return them on `ExportResult.warnings`.
- `github-repository-writer.adapter.ts`
  - When the file set includes `.github/workflows/*` and scopes are known to
    lack `workflow`: return `{ code: "workflow-scope-missing" }` error before
    any API writes. Extend `RepositoryWriterError["code"]` union.

`packages/project-generation`:

- `project-exporter.port.ts`: add `warnings?: string[]` to `ExportResult`.
- `generate-project-use-case.ts`: merge `exportResult.warnings` into output
  `warnings`.

`apps/web`:

- `/api/push/github/route.ts`: map `workflow-scope-missing` → 403 with
  `code: "workflow_scope_required"` (not `reauth_required` — the session is
  valid; the copy differs).
- `/api/export/github/route.ts`: map the reactive-remap error → 403 with
  `code: "workflow_scope_required"`, matching the push route (closes §8/Q4).
  Rationale: the degrade path (proactive scope-less detection) returns
  success+warnings so no error mapping is needed there; the reactive remap path
  (scope unknown, `createTree` 404) must produce a stable typed code so PR-2's
  client UX can surface the Reconnect GitHub action — a 500 with a message
  string is not machine-readable by the client error handler.

Tests (all mocked-fetch, following `github-exporter.adapter.test.ts` /
`github-repository-writer.adapter.test.ts` idioms):

- exporter: scope-less token → workflow files excluded from blobs+tree, warning
  returned, publish succeeds; scoped token → workflow file included, no warning;
  missing header → unchanged behavior (fail-open); createTree 404 with workflow
  path in payload → remapped message.
- writer: scope-less + workflow file in set → `workflow-scope-missing`, zero
  write calls; scope-less + no workflow file → normal commit.
- use case: exporter warnings surface on `GenerateProjectOutput.warnings`.
- routes: new code mappings.

Review pre-empt (per feedback memory): comment WHY fail-open on a missing
header is safe (reactive remap is the backstop) and why the 404 remap keys on
payload paths, so CodeRabbit/qodo don't flag either.

### PR-2 — Scope request + client UX

`apps/web`:

- `app/lib/auth.ts`: add `workflow` to the scope string.
- Client error handling (`ExportContext.tsx` + status strip / dialog copy):
  - Surface `workflow_scope_required` (and the existing but currently unused
    `reauth_required` code — today only raw HTTP 401 is special-cased in the
    editor-push arm) with distinct copy and a **Reconnect GitHub** action that
    calls `signIn("github")` (fresh sign-in refreshes `accessToken` +
    scope via the jwt callback).
  - Requires `postJson` (`app/lib/fetch-json.ts`) to expose the response body's
    `code` field on the `http-error` variant — small typed addition.
  - Success-state copy when warnings are present: count is already rendered;
    ensure the workflow-skip warning text reads well in that surface.
- Component tests per `web_component_test_gotchas` memory (container/
  presentational, prop-injected handlers).

### PR-3 (optional, cheap) — Truthful GitHub error surfaces in general

`github-git-data.client.ts` / exporter: prefix raw GitHub error passthroughs
with the failing operation ("creating commit tree") so a future opaque error is
self-locating. Skip if scope creep is a concern — PR-1's remap covers the known
case.

## 5. Verification

1. **Unit/CI:** suites above; `turbo` gates from repo root.
2. **Live degraded path:** repro harness from `apps/web/` (`yarn tsx`,
   workspace resolution requires repo cwd). **Pre-flight scope check first:**
   `curl -sI -H "Authorization: Bearer $(gh auth token)" https://api.github.com/user | grep -i x-oauth-scopes`
   — assert that `workflow` is **absent**; if present, skip this step or use a
   token known to lack it (a fresh PAT with only `repo`). Expect: success, repo
   contents WITHOUT `.github/workflows/sync-integrity.yml`, warning in result.
3. **Live full path:** run `gh auth refresh -s workflow` (or use a PAT with
   `repo`+`workflow`); re-assert `x-oauth-scopes` contains `workflow` before
   running the harness. Expect: success WITH the workflow file at HEAD.
4. **In-app E2E (after deploy):** wizard → summary → Push to GitHub with an old
   session (degraded+warning), then Reconnect GitHub → republish (workflow file
   present). Editor-push a workflow file edit with an old token → actionable
   403, not 404.
5. **Prod deploy** via `gh workflow run deploy.yml --ref main` (Martin-gated),
   then step 4 against prod.

## 6. Rollout & risk

- **Order matters:** PR-1 alone restores publish for all users (minus workflow
  file). PR-2 restores full fidelity for re-authed users. Ship PR-1 → deploy →
  PR-2 → deploy.
- **No rollback lever needed:** PR-1 is strictly additive (guard no-ops for
  scoped tokens; fail-open when header absent). Revert = git revert.
- Scope broadening (`workflow`) slightly widens token power; token already
  never reaches the browser (JWT-only, documented in `auth.ts` session
  callback) — note this in the PR body to pre-empt review flags.
- Scope-string parsing: exact separator is `", "`; parse defensively
  (split on comma, trim).
- GitHub Apps / fine-grained tokens don't emit `x-oauth-scopes`; today the app
  is OAuth-only, and fail-open + reactive remap keeps a future migration safe.

## 7. Cleanup

- Delete the two private debug repos created during the investigation (exact
  names in internal notes; token lacks the delete-repo scope — delete via
  GitHub settings UI).
- Update memory `github_publish_workflow_scope_404` as PRs land.

## 8. Open questions for Martin

1. **D1 confirm:** degrade-with-warning for scaffold publish (vs hard-fail)?
2. **Reconnect UX:** inline button in the error/status strip (recommended) vs
   copy-only instruction?
3. **Repo-side breadcrumb:** should the degraded publish also write a
   `HEXAGEN-ADDON-NOTICES.md`-style note into the repo explaining the missing
   CI workflow? (Recommended: no — UI warning suffices; the file is additive
   noise in an otherwise clean scaffold. Revisit if support questions recur.)
4. ~~**`/api/export/github` remap symmetry:**~~ **Resolved** — 403 +
   `workflow_scope_required` is required for the reactive path (see §4 PR-1
   export route entry); 500 is not viable as the client UX keys on the typed
   code.
