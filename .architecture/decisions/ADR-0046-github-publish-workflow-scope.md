# ADR-0046: GitHub Publish Error Contract, Workflow Scope, and the Reconnect Token Model

**Date:** 2026-08-13
**Status:** Accepted
**Type:** Architecture
**Resolves:** `docs/planning/github-publish-workflow-scope-remediation.md` open questions Q1/Q2 (§8) — tracked as decision D3 in `docs/planning/2026-07-25-remaining-work-consolidated-plan.md`; shipped as PRs #431 and #435
**Extends:** PR #330 (sync-integrity workflow auto-injection — the change that made this failure universal)

## Context

GitHub rejects `POST /repos/{owner}/{repo}/git/trees` with a bare **404 "Not
Found"** whenever the tree contains any `.github/workflows/*` path and the
OAuth token lacks the **`workflow`** scope (empirically proven with a
deterministic repro, 2026-07-06). PR #330 injects
`.github/workflows/sync-integrity.yml` into every generated project with the
yarn packageManager (the wizard default), and the app's NextAuth GitHub scope
was `read:user user:email repo` — so **every OAuth scaffold publish of a
yarn-default project had been broken since #330 deployed**, failing with an
unactionable raw 404. The editor-push path (`/api/push/github`) carried the
same latent failure.

Two constraints shaped the fix:

1. **Existing sessions cannot be upgraded server-side.** The NextAuth jwt
   callback copies the GitHub access token into the JWT only on a fresh
   sign-in (`account?.provider === "github" && profile`); there is no refresh
   or rotation path. Widening the requested scope fixes _new_ connections
   only — every existing session keeps its scope-less token indefinitely.
2. **The GitHub error is not self-describing.** The 404 carries no indication
   that a scope is missing; distinguishing it from "repo not found" requires
   either the `x-oauth-scopes` response header (a preflight) or recognizing
   the create-a-tree + workflow-file combination after the fact.

## Decision

Four coupled decisions, shipped as two PRs (#431 server-side, #435 scope +
client):

### 1. Degrade with warnings, not hard-fail (remediation plan D1 / open question Q1)

When the token verifiably lacks `workflow`, the exporter **proactively strips
`.github/workflows/*` files from the tree and publishes the rest**, emitting
one warning per skipped file on `ExportResult.warnings`. The publish
_succeeds_ degraded rather than failing.

Rationale: because of constraint (1), a hard-fail would keep publishing
broken for every existing user until they happen to re-authenticate. The
degrade restores publish for all users immediately with no re-auth, and the
warnings + Reconnect affordance (below) advertise the path to a full publish.
The editor-push path is the deliberate asymmetry: it pushes user-edited files
(the workflow file only if the user edited it), so it **hard-fails** with an
actionable error instead of silently dropping an edit the user explicitly
made.

### 2. A two-vocabulary error contract

Error codes exist in two deliberately distinct vocabularies:

- **Kebab-case** is the internal port vocabulary
  (`workflow-scope-missing`, `auth-failed`, `conflict`, … — declared on
  `RepositoryWriterError` and `ExportErrorCode`). The git-data client
  additionally types the one failure HTTP status cannot distinguish,
  `workflow-scope-missing`, on `GitHubApiError.code`, so adapters detect it
  without sentinel-substring matching on message text; `auth-failed` and
  `conflict` are mapped from HTTP status codes in the writer adapter.
  (Pre-existing "already exists" substring remaps for repo/branch idempotency
  are unrelated and unchanged.)
- **Snake_case** is the HTTP client contract, emitted by the routes:
  `workflow_scope_required` (HTTP 403 — the session is valid, only the scope
  is missing) and `reauth_required` (HTTP 401 — the session itself is bad).

The push route's 500s pass kebab-case writer codes through verbatim in
`body.code`; the client's shared mapper (`mapGithubPublishFailure`)
recognizes **only** the snake*case pair — plus the codeless-401 legacy
fallback described in Decision 4 — and maps everything else, including those
passthroughs, to `code: null`, i.e. \_no* reconnect affordance. That
default is intentional, not an omission: offering "Reconnect GitHub" for a
non-auth failure (a conflict, a validation error) would be actively
misleading. Anyone adding an error code later must pick the vocabulary by
audience: kebab-case for adapter/port plumbing, snake_case only when the UI
should change behavior — and must extend the mapper explicitly in that case.

### 3. Fail-open scope probe, backstopped — a paired invariant (remediation plan D3)

The proactive check reads the `x-oauth-scopes` response header
(`getTokenScopes`); when the header is absent the result is `null` = unknown,
and the writer **fails open** (proceeds as if scoped). This is safe **only**
because the reactive backstop exists: the git-data client remaps the
create-a-tree 404 (workflow file present in the _local_ tree array — the
GitHub error itself carries only status + message) to the same typed
`workflow-scope-missing` code.

These two halves protect each other and must not be removed independently:
without the backstop, fail-open silently reintroduces the raw 404; without
the proactive filter, every degraded publish costs a full failed round-trip
and loses the per-file warnings. Both halves carry code comments naming the
pairing.

### 4. Reconnect via fresh sign-in — the only token upgrade path (remediation plan D4 / open question Q2)

The requested scope is now `read:user user:email repo workflow`, and the UI
offers an **inline Reconnect action** (`signIn("github")`) rather than
copy-only guidance, on both publish surfaces (the export dialog and the
editor-push error strip). Because of constraint (1), a fresh OAuth
round-trip is the _sole_ mechanism that mints a re-scoped token — so the
degrade is **permanent for un-reconnected sessions**, and user-facing copy
states that plainly instead of implying a transitional state.

The affordance is gated strictly on the typed snake_case code:
`workflow_scope_required` labels the button "Reconnect GitHub" (session
valid), `reauth_required` labels it "Sign in to GitHub" (session expired,
preserving the exact legacy copy), and a codeless 401 falls back to
`reauth_required` for backward compatibility.

**Security posture of the widening:** the token never reaches the browser —
the NextAuth session callback exposes profile fields only, and routes read
the token server-side from the JWT. `workflow` adds exactly one capability
on top of the already-granted `repo`: pushing workflow files. Any future
change to `auth.ts` (e.g. the planned GitHub-login subscription gate) must
preserve both properties: tokens mint only on sign-in, and the session
callback never exposes them.

## Consequences

- Scaffold publishes work again for every user immediately after deploy —
  degraded (workflow files skipped, warnings shown) for pre-existing
  sessions, in full after they reconnect. #431 and #435 ship together in one
  release-gated deploy; deploying only the scope change without the server
  resilience would leave old sessions hard-broken.
- Users who reconnect see GitHub's expanded consent screen (the added
  `workflow` permission). Existing sessions see no prompt until they do.
- **Copy constraint:** no user-facing error string on the export path may
  contain a parenthesized HTTP status code — the export route remaps any
  message matching `/\((401|403)\)/` to `reauth_required`, so e.g. writing
  "(403)" into new copy would silently rebrand it as a session-expiry. The
  workflow-scope remap message is written to avoid this and the constraint
  is commented at the mapper.
- The degraded-publish success panel renders the raw warning strings; the
  count-based "overridden by add-ons" copy remains only as a counts-only
  fallback, because it mislabels workflow-scope skips.
- Post-deploy live validation (remediation plan §5) needs a token verifiably
  lacking `workflow` (curl the `x-oauth-scopes` header to confirm) — a
  reconnected developer account can no longer produce one.
- The optional PR-3 from the remediation plan (prefixing raw GitHub error
  passthroughs with the failing operation name) remains deferred; the typed
  codes reduced its urgency.
