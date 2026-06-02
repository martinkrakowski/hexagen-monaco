# GitHub Publish & Editor Push

**Status:** Plan (rev. 3 — incorporates three review passes; see _Review dispositions_)
**Suggested branch:** `feature/github-editor-push`

> Add a "connect / publish to GitHub" affordance in the project wizard, and a
> "push / update" button in the code editor that commits live edits straight to
> the connected repository.

---

## TL;DR — what's already built vs. what's new

Most of the **wizard → GitHub publish** path already exists. The genuinely new
work is the **editor push** and the **connected-repo link** that ties the two
together.

| Capability                                   | State       | Notes                                                                  |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| GitHub OAuth (token acquisition)             | ✅ Built    | NextAuth `GitHubProvider`, scope `read:user user:email repo`           |
| Wizard "Sign in / Push to GitHub" button     | ✅ Built    | `features/project-wizard/steps/summary-step/ExportActions.tsx`         |
| `POST /api/export/github` route              | ✅ Built    | Reads token from session JWT, calls the exporter                       |
| Create repo + commit scaffold (Git Data API) | ✅ Built    | `GitHubExporterAdapter` (blobs/tree/commit/upsertRef); updates too     |
| Repo PRs                                     | ⚠️ **Stub** | `GitHubVcsAdapter.createPullRequest` hardcodes `owner`/`repo` (`TODO`) |
| **Persisted project ↔ repo link**            | ❌ Missing  | Nothing stores `{owner, repo, branch, lastCommitSha}` after publish    |
| **Editor "Push / Update" button**            | ❌ Missing  | `EditorToolbar` has Edit/Save/Discard only                             |
| **Incremental commit of edited files**       | ❌ Missing  | Exporter pushes a whole `sourceDirectory`, not the in-memory dirty set |

So the user's first ask ("connect/publish in the wizard") is ~80% done; this
plan finishes it (persist the repo link) and builds the editor-push half.

---

## Goal & user stories

1. **As a user finishing the wizard**, I can connect my GitHub account and
   publish the generated project to a new repo, and the project remembers which
   repo it was published to.
2. **As a user editing code in the Monaco editor**, I can push my saved edits
   directly to that connected repo with a commit message — without leaving the
   app or re-downloading a ZIP.

---

## Architecture

Reuse the existing seams; add the minimum new ports. Two corrections from review
shape this section: **persistence is client-side** (not the stub
`packages/persistence/`), and **`project-generation` cannot import
`external-integration`** (its `allowed_imports` is only `@hexagen/shared` +
`@hexagen/sync`).

### Reuse

- **Auth** — NextAuth session JWT carries `accessToken` (`repo` scope). Token
  stays server-side; never sent to the browser.
- **GitHub Git Data plumbing** — `GitHubExporterAdapter` already does
  blobs/tree/commit/upsertRef and chains the parent SHA (so it can update, not
  just create).

### New

1. **Connected-repo model — on `SavedProject`, not a new package.**
   Persistence is client-side: `SavedProject`
   (`packages/shared/src/domain/saved-project.ts`, which carries an explicit
   `schemaVersion`) is stored via `web-driver`'s localStorage adapter, with
   migrations under `web-driver/src/infrastructure/migration/`.
   - Add an optional `githubLink?: { owner; repo; branch; defaultBranch;
lastCommitSha; htmlUrl }` to `SavedProject`.
   - **Migration mechanics (verified):** saved-projects already migrated LS→IDB
     via the `saved-projects-ls-to-idb` step, which is ID-tracked and **marked
     complete** in existing users' registries — editing it will _not_ re-run.
     So add a **new** step (`SavedProjectsV3MigrationStep`, id
     `saved-projects-v2-to-v3`) that backfills `githubLink: undefined`, bump
     `CURRENT_SCHEMA_VERSION` (`apps/web/app/hooks/useSavedProjects.ts`, currently
     `2` → `3`), and **register the step in the `MigrationOrchestrator([...])`
     array in `apps/web/app/lib/wire.client.ts`**. Backend is IndexedDB
     (`idb-saved-projects.adapter.ts`); records without `githubLink` must still
     load.
   - `packages/persistence/` is a `yarn sync` stub (`export {}`) — **do not
     target it.**

2. **GitHub Git Data adapter lives in `external-integration` (infrastructure),
   implementing the ports.**
   `external-integration` is the integration-plane home for VCS adapters (it
   already owns `IVersionControlSystem` + `GitHubVcsAdapter`). To avoid the
   forbidden `project-generation → external-integration` edge:
   - **Relocate** the Git Data API client/adapter into `external-integration`
     (shared by both the initial export and the new commit path — removes the
     current exporter/VCS duplication).
   - Keep `ProjectExporterPort` where its use case consumes it; `external-
integration` provides the implementation, wired in the **composition root**
     (`apps/web/app/lib/wire.server.ts`). Settle exact port placement in
     implementation (a `shared` git-primitive type may be needed so neither
     package imports the other against the rules).
   - Add `commitFiles(link, files, message, token)` (a `RepositoryWriterPort`):
     reads branch HEAD, builds a tree based on it, commits, fast-forwards the
     ref, returns the new SHA. In-memory double + tests.
   - **Token injection:** today `GitHubExporterAdapter` is built with a token at
     construction inside `getGenerateProject()` (`wire.server.ts:102`). Once the
     client is shared, prefer **token-per-call** (or an injected factory) so one
     long-lived client serves requests for different users — this directly shapes
     the `commitFiles`/exporter signatures.
   - **Files shape:** the port takes a `Record<path, content>` / array, **not a
     `Map`** — the `/api/push` body is JSON (the Map→Record serialization already
     happens for IDB persistence).

3. **`POST /api/push/github` route** — authn via session JWT → load the
   project's `githubLink` → `commitFiles` with the editor's **dirty** files →
   persist the new `lastCommitSha` → return commit URL. On GitHub `401/403`,
   return a distinct error code so the UI can prompt re-auth (see Security).

4. **Editor UI** — a "Push / Update" control + commit-message field in
   `EditorToolbar` / `EditableMonaco`. The editor workspace already tracks
   `files: Map<fileId, { …, dirty }>` (`useEditorWorkspace` /
   `PersistedEditorWorkspaceFile`), so **push the whole _unpushed_ set in one
   commit** (building a tree from N files is the same Git Data API shape as one).
   - **`dirty` ≠ unpushed.** `dirty` means "unsaved local changes"; after a local
     save it flips to `false` but the file still hasn't been pushed. Push
     eligibility needs a **second signal** — add an `unpushed: boolean` (or
     per-file `lastPushedSha`) to the workspace file model, set on save and
     cleared on successful push. Enable Push only when (connected ∧ any unpushed).

### Data flow

```text
Wizard publish:  ExportActions → /api/export/github → GitHub export
                 → persist SavedProject.githubLink{owner,repo,branch,lastCommitSha,htmlUrl}

Editor push:     EditorToolbar(Push) → /api/push/github
                 → load githubLink → commitFiles(link, dirtyFiles, message)
                 → update lastCommitSha → toast(commit URL)
```

---

## Phases

**Phase 1 — Persist the connected repo** _(unblocks everything)_

- Add optional `githubLink` to `SavedProject`; add a **new** `SavedProjectsV3`
  migration step (new id) registered in the `wire.client.ts` orchestrator array,
  bump `CURRENT_SCHEMA_VERSION` 2→3. Update the IDB saved-projects adapter to
  round-trip the field.
- On successful wizard publish, store the link; show a "Connected to
  `owner/repo`" indicator.
- _Exit:_ a published project reloads with its repo identity intact (incl. an
  older record saved before this change).

**Phase 2 — Commit capability in `external-integration`**

- Relocate the Git Data API client into `external-integration`; add
  `commitFiles(link, files, message)` + in-memory double + tests
  (base-on-HEAD, fast-forward, returns new SHA).
- Update `.architecture/contexts/infrastructure/external-integration/context.yaml`
  (new port), adjust `linter-config.yaml` `package_rules` for any new
  cross-package edge, and run **`yarn lint:arch`**.
- _Exit:_ a test commits a changed file via the in-memory double; `lint:arch`
  green.

**Phase 3 — Editor push UI**

- Add an `unpushed` signal to the workspace file model (set on save, cleared on
  successful push). Add "Push / Update" + commit-message UX to `EditorToolbar` /
  `EditableMonaco`; wire to `POST /api/push/github` (JSON body = `Record` of
  unpushed files).
- _Exit:_ edit → save → push updates the repo; toast links the commit; `unpushed`
  flags clear.

**Phase 4 — Robustness & options**

- Conflict handling: if remote HEAD moved since `lastCommitSha`, warn / offer a
  branch (this is also where the **`createPullRequest` stub must be wired** —
  `owner`/`repo` from `githubLink` — if PR mode is enabled).
- "Connect to an existing repo" picker (list user repos via the API).
- Connection/status surfaces in the workspace shell; error/retry states.

---

## Security

- **Token never leaves the server.** Routes read it via `getToken()` from the
  NextAuth JWT; the browser only sees commit URLs/status.
- **Scope.** `repo` is already requested. It is broad; a future **GitHub App**
  (per-repo, short-lived tokens) is the hardening path if this goes multi-tenant.
- **Authorization per push.** Re-verify the session on every `/api/push` call;
  confirm the session user can write to `githubLink.owner/repo`.
- **Token staleness / revocation.** The link may have been created days ago; the
  OAuth token can be revoked or the session expired. The push route must map
  GitHub `401/403` to a distinct response code (e.g. `reauth_required`) so the
  UI prompts the user to sign in again rather than showing a generic failure.
- **Rate limits.** Git Data API is several requests per commit; debounce pushes
  and surface secondary-rate-limit errors clearly.

---

## Open decisions (recommendations confirmed by review)

1. **New repo first; existing-repo picker in Phase 4.** ✔ both reviews.
2. **Commit direct to the default branch** (emulates a local save); PR mode is an
   opt-in later — and requires fixing the `createPullRequest` stub regardless.
3. **Push the whole dirty set, not just the active file.** ✔ the editor workspace
   already tracks all dirty files; the tree build is identical cost. _(Revised
   from rev. 1, which had assumed the single-file `EditableMonaco` view.)_
4. **Incremental commit (base-on-HEAD)**, not full re-push.
5. **No PAT/BYOK fallback in v1** (OAuth is wired).

---

## Files in scope (corrected)

- `packages/shared/src/domain/saved-project.ts` — add optional `githubLink`
- `apps/web/app/hooks/useSavedProjects.ts` — `CURRENT_SCHEMA_VERSION` 2→3
- `packages/shared/src/domain/persisted-editor-workspace.ts` — add `unpushed` to the file model
- `packages/web-driver/src/infrastructure/adapters/idb-saved-projects.adapter.ts` — round-trip the link (IDB is the live backend)
- `packages/web-driver/src/infrastructure/migration/` — **new** `saved-projects-v3` step (new id)
- `apps/web/app/lib/wire.client.ts` — register the new migration step in the orchestrator array
- `packages/external-integration/` — relocate Git Data client; add `commitFiles` port + adapter + in-memory double + tests
- `.architecture/contexts/infrastructure/external-integration/context.yaml` + `.architecture/invariants/linter-config.yaml` — declare the new port / cross-package edges, then `yarn lint:arch`
- `apps/web/app/lib/wire.server.ts` — composition-root wiring
- `apps/web/app/api/push/github/route.ts` — **new** editor-push route
- `apps/web/app/api/export/github/route.ts` — persist the link on publish (exists)
- `apps/web/features/project-wizard/steps/summary-step/ExportActions.tsx` — "connected" indicator (exists)
- `apps/web/features/monaco-editor/editable-monaco/EditorToolbar.tsx` + `EditableMonaco.tsx` — Push button + commit message
- `apps/web/features/workspace-shell/hooks/useEditorWorkspace.ts` — expose dirty set + push handler

> Note: `packages/persistence/` and a new `project-configuration` value object —
> **removed** from the file list (rev. 1 mistakes): persistence is the stub, and
> the link rides on `SavedProject` in `shared`.

---

## Review dispositions

### rev. 2 → rev. 3 (archeology + nit pass)

- **Migration mechanics corrected** — a completed migration step won't re-run on
  code change; added a **new** `saved-projects-v3` step (new id) + orchestrator
  registration in `wire.client.ts`, and located `CURRENT_SCHEMA_VERSION` (2→3) in
  `useSavedProjects.ts`. Backend is IDB.
- **`unpushed` ≠ `dirty`** — `dirty` clears on local save; added an `unpushed`
  signal for push eligibility.
- **Token injection** — relocation favors token-per-call (or factory); shapes the
  `commitFiles` signature. Noted `wire.server.ts:102` impact.
- **Files shape** — `commitFiles` takes a `Record`/array, not a `Map` (push body
  is JSON; Map→Record serialization already exists for IDB).

### rev. 1 → rev. 2

- **Persistence target fixed** — was `packages/persistence/` (a `yarn sync`
  stub); now `SavedProject` (shared) + `web-driver` localStorage adapter +
  migration. _(Review #1.)_
- **`createPullRequest` downgraded** ✅→⚠️ Stub (hardcoded `owner`/`repo`).
  _(Review #1.)_
- **Schema migration added** — `schemaVersion` bump + migration step. _(Review #1;
  supersedes Review #2's "no migration needed" — that applies to the idb-keyval
  generation-results store, not the migration-backed `SavedProject` store.)_
- **Token-staleness handling added** to Security (`401/403 → reauth_required`).
  _(Review #1.)_
- **Adapter placement corrected** — relocate the Git Data client to
  `external-integration`; `project-generation` may import only `@hexagen/shared`
  - `@hexagen/sync`, so a core-imports-infra extraction would fail `lint:arch`.
    Added the `context.yaml` / `linter-config.yaml` / `lint:arch` steps. _(Review #2.)_
- **Push scope changed to the dirty set** — `useEditorWorkspace` already holds a
  `Map` of dirty files. _(Review #2.)_

## Out of scope (v1)

- GitHub App installation flow (vs OAuth App)
- Multi-provider VCS (GitLab/Bitbucket) — `external-integration` already abstracts
  a git-provider port, so it's a natural extension
- History/blame, merge-conflict resolution beyond guard-and-warn
