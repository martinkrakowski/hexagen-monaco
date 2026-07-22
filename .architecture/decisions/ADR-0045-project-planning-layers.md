# ADR-0045: Project Planning Layers — Provenance Layer Stacks and Interactive Brainstorm Sessions

**Status:** Accepted
**Date:** 2026-07-21
**Authors:** Architecture Co-pilot, Human Architect
**Related to:** `docs/planning/project-planning-layers.md` (Phase 1–2 build plan)
and `docs/planning/project-planning-layers-interactive-sessions.md` (Phase 3
design and v1 build decisions)

---

## Context

A saved project stored only its distilled outputs — the wizard `formState` and
the canonical `manifestYaml`. The upstream **planning session** that produced
the manifest was thrown away: it happened in an external chat, was
hand-distilled into a manifest, and only the manifest was imported. The
motivating case is the "Vellum" 3D-packaging brainstorm — a long
propose→critique→revise session between two models plus a human that became a
16-context hexagonal manifest with no trace of its own reasoning left in the
project.

The decision: a project becomes a small **stack of provenance layers** —
`Plan` (brainstorm, decisions) alongside `Architecture` (the manifest) — and,
in its final phase, the app **runs** the brainstorm itself.

Three persistence realities (verified in the plan doc's codebase review)
constrain every design choice below:

- IndexedDB persistence is **one idb-keyval key holding the whole projects
  array**; every save is a whole-array replace.
- `useSavedProjects` is **per-mount with no shared store** — each instance
  snapshots the array once, so a stale-instance write silently reverts fields
  written elsewhere (this already bit `githubLink.lastCommitSha` before this
  work).
- `ActiveWorkspaceContext` is a localStorage snapshot, copied at three sites,
  never refreshed after a mutation, with quota errors swallowed.

Delivery: Phase 1 (capture + view) merged as PR #404 (schema/persistence) +
PR #405 (Plan-phase UI + import capture). Phase 2 (provenance + structure) =
PR #414 and Phase 3 (interactive sessions v1) = PR #415, built in parallel
against a shared schema contract; Phase 2 merges first.

## Decision

### Part A — the provenance layer model (Phases 1–2)

#### D1 — Layers are a parallel provenance store; `manifestYaml` stays canonical

`SavedProject` gains `layers?: ProjectLayer[]` (optional on the shared domain
type in `packages/shared/src/domain/saved-project.ts`; the app-level type in
`useSavedProjects` requires it, upheld at the load perimeter by the
normalizer, with a defensive `?? []` where the hook narrows the shared
type). The manifest is **not** modeled as a layer.

_Rejected: a manifest-as-layer refactor, and (Q6, reaffirmed in Phase 3)
architecture-snapshot layers. Both would put the working import → accept →
preview path at regression risk for zero v1 payoff; latest-only manifests
remain the contract._

#### D2 — Turns, not a markdown blob; free-form authors; ids at creation

A layer holds ordered `ProjectLayerTurn[]` (`id` = `crypto.randomUUID()` at
creation, `author` free-form string, `content` markdown). Turn ids are a
Phase-1 need (stable React keys, salvage can drop a turn and shift indexes,
last-writer-wins persistence makes positional references un-mergeable), not
future-proofing. `author` is a string, not a role enum — a multi-party
planning session is not `user | assistant`. Phase 3 later added optional
`turn.role` / `turn.round` **alongside** `author`, additively.

#### D3 — Salvage-not-drop at the load perimeter

`normalizeLoadedProjects` (idb adapter) is the single point upholding the
app-level contract: default the missing field to `[]` on both push paths,
drop a **turn** only when its `content` is unusable, default unknown `kind`
to `"brainstorm"` with a warning, drop malformed `link` / `sourceLayerId`
field-level. Metadata damage never deletes a layer or a project.

#### D4 — The workspace seam is `projectId` only; `ActiveWorkspaceContext` must not carry layers

The Plan phase reads and writes layers via `useProjectLifecycle`'s **own**
`useSavedProjects` instance, threaded through `WizardLifecycleContext`.
`ActiveWorkspaceContext` (stale localStorage snapshot) never gains `layers`.

#### D5 — Layer mutations are awaited; Phase 3 escalates to read-merge-write

Phase 1's `addLayer` / `updateLayer` / `removeLayer` follow the awaited
`saveProject` template (fire-and-forget `updateProject` + the zero-consumer
`persistError` signal are not acceptable for user-authored content), with
unknown/genesis ids as explicit no-ops. Phase 3, whose loop writes turns
concurrently with wizard autosaves, replaces whole-array snapshot writes with
`updateProjectRecord(id, updater)` — a **read-merge-write** on the
persistence port (fresh read at write time, single-record update), plus an
IDB-adapter promise queue serializing same-tab writes. A mid-session autosave
can no longer clobber freshly appended turns.

#### D6 — The Plan phase is a whole-shell swap

`Plan ↔ Architecture` is a top-level phase switcher: Plan replaces the whole
3-pane workspace below the Header, URL-backed via `?phase=`, hidden in
genesis (unsaved) mode, and respectful of the unsaved-editor guard. It is a
first-class phase, not a pane or a notes field.

#### D7 — Provenance is captured and linked at accept-save, per flow

The import flow's accept-save creates the brainstorm layer from
`pendingManifest.originSpecText` (a per-flow store field — **not** a durable
`sessionStorage` key, which leaked stale specs onto unrelated projects) and
stamps the discriminated link
`ProducedManifestLink { type: "produced-manifest"; at }` on it. The
Architecture phase renders a "Derived from your planning session" affordance
(`DerivedFromPlanLink`); navigation is click-only in both directions.

#### D8 — Decisions extraction is a route-local, non-streaming completion

`POST /api/plan/extract-decisions` mirrors `/api/llm/chat`'s server-key path
(pinned `LLM_MODEL`, rate limiter, anonymous daily quota) but calls
`LLMProviderPort.complete()` directly — no BYOK branch, no reuse of the
streaming `HandleServerChatUseCase`, no new package barrel exports.
Extraction counts against the existing `"chat"` quota kind; output is an
appended `kind: "decisions"` layer. An explicit `maxTokens: 4096` plus a
visible truncation notice on `finishReason === "length"` prevents presenting
a cut-off summary as complete.

### Part B — interactive brainstorm sessions v1 (Phase 3)

The app runs a proposer⇄critic loop, persisted turn-by-turn into a
`brainstorm` layer, driven by a pure reducer state machine
(`proposing → critiquing ⇄ revising → converged → finalizing → done`, with an
`awaiting-human` park for cap-reached / error / paused). The design doc's
open questions were resolved for v1 as follows (full rationale in the doc's
"v1 build decisions" section):

- **Q0 — client-driven loop.** The browser tab owns the loop over the
  existing `/api/llm/chat` route (`usePlanningSession`). No server session
  store, no new streaming protocol. Accepted consequence: the loop dies with
  the tab; the persisted non-terminal `status` yields a Resume/End banner on
  next mount.
- **Q1 — one model, two role prompts.** Both roles use the standard chat
  route; the server-key arm pins the deployment's `LLM_MODEL`. The
  proposer/critic split is prompt-level. No new model-config surface.
- **Q2 — critic self-declared verdict.** The critic ends with
  `VERDICT: CONVERGED | CONTINUE` (forgiving trailing-line parse). Missing or
  malformed = CONTINUE plus a logged warning — never a stall. Backstops: the
  round cap and a human **Force converge** control.
- **Q3 — round cap fixed at 4**, not user-editable in v1. The cap parks the
  session at `awaiting-human`; Resume past it is an explicit human extension
  advancing the round by one.
- **Q4 — finalize distills to editable spec text.** One chat call produces
  `contexts:`-dialect YAML (the deterministic structured-config import path)
  in an editable review; only an explicit **Confirm** seeds the existing
  import flow, creating a **new** project. Never auto-navigates.
  Update-existing-project acceptance is deliberately out of v1 scope.
- **Q5 — existing chat quota, disclosed.** No new quota surface; the UI
  states the per-round cost (2 requests) and finalize's extra call.
- **Q6 — latest-only manifests** (see D1).

Two hardening decisions from review are load-bearing:

- **Loop teardown is generation-based.** Superseding actions (pause /
  force-converge / end / unmount) bump a loop generation synchronously and
  abort in-flight streams; an in-flight turn persist is reconciled via a
  pending-append ref so a durably persisted turn applies exactly once and
  resume never re-runs an already-persisted role. (The original
  implementation left a zombie loop appending to a stale layer after
  unmount.)
- **The source layer is stamped `done` + linked at the import accept-save,
  not at Confirm-time**, guarded by an exact (whitespace-trimmed) spec-text
  match. Confirm routes
  through the cancellable workspace-exit guard dialog; stamping there would
  strand a `done` layer with no manifest. Until a manifest exists, the layer
  stays in a recoverable state.

## Consequences

### Positive

- **Provenance closes the loop**: idea → in-app brainstorm → manifest →
  generated code, with each step linked to the one before it.
- **Additive schema throughout** — no data migration beyond the v3-mirroring
  v4 stamp; the manifest pipeline, accept flow, and preview path are
  untouched (D1).
- **Zero new server infrastructure** for Phase 3 (Q0/Q1/Q5): sessions reuse
  the chat route, its model pinning, and its quota; the only new route (D8)
  is a thin non-streaming mirror.
- The read-merge-write port (D5) retires the whole-array clobber class for
  layer writes: fresh read at write time, single-record update, and same-tab
  serialization — strictly stronger than the fresh-read-but-whole-array-save
  pattern `persistGithubLink` uses today.

### Negative

- **The session loop is tab-bound** (Q0). Interrupted sessions are
  recoverable but a critic verdict lost mid-stream is re-run, and long
  sessions burn per-turn chat quota with no server-side resumption.
- **One model playing both roles** (Q1) limits genuinely adversarial
  critique; the split is rhetorical, not epistemic. Accepted for v1 — the
  role seam is prompt-level, so a second model slots in without schema work.
- The finalize hand-off is **lossy by construction** (Q4): the distilled
  `contexts:`-dialect text, not the transcript, is what the import pipeline
  sees. The transcript rides along as provenance, but decisions not captured
  by the distill do not reach the manifest.
- Only layer mutations use D5's read-merge-write port method so far. The
  hook's other mutations (and wizard autosave) still persist stale full-array
  snapshots, which can revert fields written through the port by
  `ExportContext` / `useEditorPush` — the pre-existing
  `githubLink.lastCommitSha` clobber. Migrating those writers to
  `updateProjectRecord` is a follow-up.

### Neutral

- Future layer kinds (`research`, `code`, `deploy`) are a union widening
  **plus a matching update to the load-perimeter salvage whitelist in the
  same release**: the Phase-2 normalizer whitelists known kinds and defaults
  strays to `"brainstorm"`, so a kind shipped without its whitelist entry
  would be relabeled by older builds on their next write (this trade-off is
  documented at the union's declaration site).
- Q0 is revisitable: a server-driven session loop can layer on later without
  unwinding v1 — the reducer, verdict protocol, and layer schema are
  transport-agnostic.
- Recovery derives everything from existing fields (round from turn stamps,
  `finalizing` → `converged`, cap-park re-derivation) — deliberately **no**
  recovery-specific schema fields.

## Verification

- Phase 1: apps/web suite green at merge (561 tests incl. normalize salvage,
  v4 migration mirror, hook round-trip/failure-revert/no-op, plan-phase UI).
- Phase 2 (PR #414): 79 files / 630 tests; turbo typecheck + lint clean
  (29 tasks). Link stamping, adapter salvage, splitting, and extraction
  (incl. truncation notice) are test-pinned.
- Phase 3 (PR #415): 84 files / 674 tests + web-driver 42; reducer,
  verdict parse, fold, stream turn, recovery mapping, accept-save layer
  derivation, and write serialization are test-pinned.

## References

- `docs/planning/project-planning-layers.md` — locked decisions, codebase
  review, Phase 1 build order
- `docs/planning/project-planning-layers-interactive-sessions.md` — session
  lifecycle design, open questions Q0–Q6 + v1 resolutions
- PRs: #403 (plan docs), #404 + #405 (Phase 1), #414 (Phase 2), #415
  (Phase 3)
- `packages/shared/src/domain/saved-project.ts` (`ProjectLayer`,
  `ProjectLayerTurn`, `ProducedManifestLink`)
- `packages/shared/src/application/ports/saved-projects-persistence.port.ts`
  (`updateProjectRecord`, D5)
- `apps/web/app/hooks/useSavedProjects.ts` (layer mutations, D5)
- `apps/web/features/workspace-shell/plan-phase/` (Plan phase UI; Part B's
  loop lives in its `session/` subfolder — `usePlanningSession.ts`,
  `planning-session.ts`, `verdict.ts`, `fold.ts`, `stream-chat-turn.ts`,
  `distill.ts`)
- `apps/web/app/api/plan/extract-decisions/route.ts` (D8)
