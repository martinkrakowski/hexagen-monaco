# Project planning layers — capturing brainstorm provenance

**Status:** planned (2026-07-01 · revised 2026-07-06 after full codebase review) · **Owner:** Martin
**Driver:** Today a project stores only its distilled outputs — the structured
`formState` and the `manifestYaml`. The upstream **planning / brainstorm session**
that produced the manifest is thrown away (it happens in an external chat, gets
hand-distilled into a manifest, and only the manifest is imported). We want a
project to keep its **provenance**: the brainstorm layer alongside the manifest
it produced. The motivating example is the "Vellum" 3D-packaging HITL brainstorm
— a long Grok↔Claude propose→critique→revise session that became the 16-context
hexagonal manifest currently imported (scene-orchestration = the state machine,
scene-port = `ThreeJsSceneAdapter`, review-lifecycle = the iteration model,
audit-governance = the `AuditTrail`, …). That session should live _in_ the
project, replayable next to the architecture it produced.

---

## Locked decisions (v1)

Resolved with the user before planning the build (the last row was resolved by
the 2026-07-06 review):

| Decision         | Choice                                                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1 scope**     | **Archive now, schema ready for live.** Store + view the (already-done) brainstorm as a project layer, but model it as ordered _turns_ so interactive in-app sessions (Phase 3) slot in without a schema rewrite.                  |
| **Placement**    | **Project phase switcher** — a top-level `Plan ↔ Architecture` toggle on the saved-project workspace. Frames the brainstorm as a first-class phase, not a buried notes field.                                                      |
| **Ingestion**    | **Paste / import the markdown transcript** — lossless, no fragile auto-parsing of an unlabeled multi-agent transcript.                                                                                                             |
| **Toggle scope** | **Whole-shell swap.** Plan replaces the entire 3-pane layout below the Header (consistent with the "first-class phase" framing), URL-backed via a `?phase=` search param, and hidden in genesis (unsaved) mode. Details in step 6. |

---

## Current state (grounded)

Verified against the codebase so the plan fits the real architecture:

- **`SavedProject`** — `packages/shared/src/domain/saved-project.ts`:
  `{ id, name, schemaVersion, createdAt, updatedAt, formState, manifestYaml, githubLink?, githubPublishPrefs? }`,
  all fields `readonly`. Two nuances that matter to this plan: `schemaVersion` is
  typed plain `number` (not a literal), so the v4 bump touches only
  `CURRENT_SCHEMA_VERSION = 3` in `useSavedProjects.ts` — no shared-type change;
  and `formState` is `Record<string, unknown>` in the shared type, narrowed to
  `ProjectConfig` (= `ProjectSpec` alias) only by the hook's local
  `SavedProject extends BaseSavedProject`. That app-boundary narrowing is the
  pattern `layers` reuses (see the type-contract note below). No
  planning/notes/history field exists today.
- **Persistence is migration-safe** — IndexedDB behind
  `SavedProjectsPersistencePort` (`IDBSavedProjectsAdapter`).
  `"hexagen:saved-projects"` is an idb-keyval **key holding the entire projects
  array as one value** — every save is a whole-array replace (this drives the
  mutation design in step 3). Versioned, ID-tracked migration steps (v1→v2
  LS→IDB, v2→v3) run once at init via the migration orchestrator in
  `apps/web/app/lib/wire.client.ts`. The v3 step's actual mechanics — stamp
  records with `schemaVersion < 3` up to 3 via spread, skip the write when
  nothing needs bumping, verify by read-back — are exactly what the v4 step
  mirrors. `normalizeLoadedProjects` (idb adapter) defaults drifted records,
  **never lets one bad record fail the load**, and **spreads unknown top-level
  keys through unchanged** — so a `layers` field already round-trips the load
  path today; only turn-level validation is new work.
- **Mutations** — `apps/web/app/hooks/useSavedProjects.ts` exposes
  `saveProject / updateProject / loadProject / renameProject / deleteProject`.
  `saveProject` is **awaited** (its own comment: returning before the write
  resolved lost approved projects); the others are optimistic fire-and-forget,
  and their failure signal (`persistError`) has **zero consumers** app-wide.
  The hook is **per-mount with no shared store**: each instance loads the array
  once and never re-syncs, and every mutation persists the full array from that
  instance's private snapshot. The wizard route mounts two instances today
  (`wizard/layout.tsx` + `useProjectLifecycle`), and `ExportContext` /
  `useEditorPush` write `githubLink`/publish-prefs directly through the port
  without any mounted instance noticing — a stale-snapshot full-array write from
  one writer silently reverts fields written by another (this already bites
  `githubLink.lastCommitSha` today). Step 3 designs around this.
- **The workspace UI has most of the pieces** — the saved-project workspace is a
  3-column resizable shell (`features/workspace-shell/ProjectWorkspace.tsx`:
  Wizard │ Architecture preview │ AI governance). Its middle pane is
  `ArchitecturePreviewPane` (GraphCanvasWrapper / CodeView behind the
  `@hexagen/ui` `ViewToggle`, URL-driven `?view=`); the tab-switching
  `ManifestPreview` (context-map / mermaid / validation) lives in the **pre-save
  accept flow**, not the workspace. `components/chat/ChatMarkdown.tsx`
  (react-markdown + remark-gfm, image-hardened — from #397) renders a transcript
  for free; **`ChatMessageList` is not reusable as-is** — it hard-codes a binary
  `user | assistant | system` role model (plain-text right-aligned user turns,
  no author-label surface), so the Plan view gets a small `PlanTurnList` built
  directly over `ChatMarkdown` (step 4). `ActiveWorkspaceContext`
  (`apps/web/app/contexts/ActiveWorkspaceContext.tsx`) is a
  **localStorage-persisted snapshot** (`hexagen-active-workspace`, quota errors
  silently swallowed) copied at three sites and never refreshed after a
  mutation — it carries `wizardData` + `manifestYaml` and must **not** gain
  `layers` (see the seam note after step 7).
- **Housekeeping found during review** — `apps/web/app/lib/data/projects.ts` is
  a dead raw idb-keyval path that bypasses the port and
  `normalizeLoadedProjects` entirely; delete or annotate it in PR 1 so it can't
  resurface as an un-normalized reader.

---

## The model — a project as a layer stack

A project stops being "one manifest" and becomes a small **stack of provenance
layers**:

```
Layer 0: Brainstorm    (the planning session)
Layer 1: Architecture  (the manifest — stays in manifestYaml, untouched)
   └─ future: Code, Deploy, …
```

Additive schema, shaped now for a _live_ session later:

```ts
// packages/shared/src/domain/saved-project.ts
export interface ProjectLayerTurn {
  id: string; // crypto.randomUUID() at creation
  author: string; // free-form: "Grok" | "Claude" | "You" | "Imported"
  content: string; // markdown
  at?: number; // optional timestamp
}
export interface ProjectLayer {
  id: string;
  kind: "brainstorm"; // union-ready for "research" | "decisions" | …
  title: string; // "Initial brainstorm (Grok ↔ Claude)"
  turns: ProjectLayerTurn[]; // v1 paste = one turn; a live session appends turns
  createdAt: number;
  updatedAt: number;
}
export interface SavedProject {
  /* …existing… */
  readonly layers?: ProjectLayer[]; // optional on the shared domain type
}
```

**Why these shapes**

- `manifestYaml` **stays the canonical Architecture artifact**. `layers` is a
  _parallel_ provenance store holding only the brainstorm. No manifest-as-layer
  refactor in v1 — that's exactly where a regression in the working import /
  accept / preview path would hide.
- `turns` (not a single markdown string) is deliberate. A multi-**agent** session
  is not `user`/`assistant`; and modelling turns now means Phase 3's live sessions
  append to the same structure instead of forcing a schema reshape. A v1 paste is
  simply one turn with `author: "Imported"`.
- **`turn.id` is non-negotiable, and it's a Phase-1 need, not future-proofing:**
  the turn list needs stable React keys, the normalize salvage rule (step 2) can
  remove a turn and shift every index after it, and last-writer-wins persistence
  makes positional references un-mergeable. Phase 2/3 provenance ("converged
  round K") then gets a durable anchor for free. One `crypto.randomUUID()` at
  creation now (the same idiom `saveProject` already uses for project ids)
  versus a data migration later.
- `author` is a free string, not a role enum — this is a multi-party planning
  session (two models + the human), rendered with an author label + alternating
  styling over `ChatMarkdown`.
- **Type contract:** `layers?:` stays optional on the shared domain type (honest
  for raw/legacy records and the write path), and the app-level `SavedProject`
  in `useSavedProjects` — which already narrows `formState` — declares
  `layers: ProjectLayer[]` **required**, with `normalizeLoadedProjects` as the
  single point that upholds it (the `[]` default added to **both** of its push
  paths, pinned by a unit test). Consumers never write `saved.layers ?? []`.
- Phase 3 will need additive fields (`layer.status`, `turn.role`, provenance —
  see [the interactive-sessions design](./project-planning-layers-interactive-sessions.md)).
  They are deliberately **not** added in v1; normalize's unknown-key spread
  keeps additive extension cheap.

---

## Phased roadmap

- **Phase 1 — capture + view (this plan, days).** v4 schema field + migration +
  normalize-default → a **"Plan" phase view** rendering the brainstorm as authored
  markdown turns → an **"Add planning session"** paste/import action → persist via
  an **awaited, clobber-safe** layer mutation. Brings the entire session back into
  the project.
- **Phase 2 — provenance + structure.** A "Derived from your planning session →"
  link between Architecture and Plan (the `AuditTrail` instinct applied to the
  project itself) — this is where `ProjectLayer` gains a link/derivedFrom field;
  multiple named layers; an optional LLM pass that extracts the _finalized
  artifacts / decisions_ into a "Decisions" summary. Optional delimiter-based
  turn splitting (`## Author` markers) for nicer threading.
- **Phase 3 — interactive sessions (the real product, multi-week).** The app
  _runs_ the brainstorm — a multi-agent propose→critique→revise loop, stored
  turn-by-turn, ending in "Finalize → generate manifest" that feeds the existing
  staged pipeline. Closes the loop: idea → in-app brainstorm → manifest →
  governance, all stored as layers. Designed in
  [project-planning-layers-interactive-sessions](./project-planning-layers-interactive-sessions.md).

---

## Phase 1 — build order (the v1)

Schema first (define the contract, build against it), then persistence, then read,
then write, then placement. Two PRs: **#1–#3** (foundation) and **#4–#7** (UI).

### 1. Schema — the contract

`packages/shared/src/domain/saved-project.ts`: add `ProjectLayerTurn` (with
`id`), `ProjectLayer`, and `layers?: ProjectLayer[]` on `SavedProject`; make
`layers` required on the app-level `SavedProject` in `useSavedProjects` (as
above).

### 2. Persistence — v4

- Bump `CURRENT_SCHEMA_VERSION` 3 → 4 (`useSavedProjects.ts`).
- New `SavedProjectsV4MigrationStep` mirroring the v3 step's shape
  (`packages/web-driver/src/infrastructure/migration/saved-projects-v3-migration-step.ts`):
  stamp records with `schemaVersion < 4` up to 4 via spread (no other transform
  — pre-v4 records simply lack `layers`), skip the write when nothing needs
  bumping, verify by read-back; register in the orchestrator (`wire.client.ts`).
- While here: the schema-version constant is duplicated across three files
  (`useSavedProjects.ts` = 3; the dead-but-exported
  `LocalStorageSavedProjectsAdapter` = 3, which would silently keep stamping 3
  if ever resurrected; the v1→v2 step deliberately frozen at 2). Either hoist a
  single exported `SAVED_PROJECT_SCHEMA_VERSION` into `@hexagen/shared` next to
  the type, or annotate the dead adapter — future bumps should be single-site.
- `normalizeLoadedProjects` (`apps/web/app/lib/adapters/idb-saved-projects.adapter.ts`):
  default `layers` to `[]` when missing — in **both** push paths. Turn
  validation follows the loader's own documented salvage policy ("never dropped
  … dropping it would be a silent regression"), **not** a drop-on-invalid rule:
  a turn is dropped **only** when `content` is not a usable string; a missing or
  mistyped `author` defaults to `"Unknown"`, a missing `id` is synthesized, a
  bad `at` is removed — and it logs, like the loader does. A brainstorm turn is
  the user's only copy of that prose; metadata damage must not delete payload.

### 3. Mutations

`useSavedProjects`: `addLayer(projectId, layer)` / `updateLayer` / `removeLayer`
— but **not** on the `updateProject` template. Two deviations, both forced by
verified behavior:

- **Awaited, not fire-and-forget.** `updateProject` is void with an un-awaited
  `.then`, and `persistError` is consumed nowhere — a failed write would show
  the layer, then silently revert it, with the modal already closed. The
  likeliest failure for a big pasted transcript is exactly
  `StorageQuotaExceeded` (already mapped by the adapter). `addLayer` mirrors the
  **`saveProject`** template instead: await the write, return success/failure,
  and let the paste modal stay open and surface the error (the repo has learned
  this lesson twice, in writing — `saveProject`'s comment and
  `ManifestAcceptPage`'s).
- **Clobber-safe.** Every hook mutation rewrites the whole array from its own
  instance's snapshot, and the wizard autosave (`updateProject` on Next, in
  `useProjectLifecycle`) runs on the lifecycle instance. If `addLayer` ran on a
  _different_ instance, the next autosave would overwrite the store from a
  snapshot that never saw the layer — silent loss. So layer mutations are
  exposed **through `useProjectLifecycle`'s own hook instance** and threaded to
  the Plan view; the autosave's `{...p}` spread then preserves layers by
  construction. Adapter-level read-merge-write per record is the optional
  belt-and-braces hardening (it would also fix today's latent
  `githubLink.lastCommitSha` clobber) but is not required for v1.

`updatedAt` bumped on every layer mutation, persisted through the port.

### 4. Read view — the "Plan" phase

`PlanPhaseView`: renders `layers` (kind `brainstorm`) as authored markdown turns
via a new small **`PlanTurnList`** built directly over `ChatMarkdown` — author
label + alternating styling, keyed by `turn.id`. (Not an adapter over
`ChatMessageList`: that primitive hard-codes binary user/assistant roles,
renders user turns as plain text, and has no author-label surface — mapping
free-form authors onto it would strip markdown from half the turns.) Empty
state → "Add planning session".

### 5. Ingestion — paste / import

"Add planning session" modal (`@hexagen/ui` `Dialog`; `@hexagen/ui` already
ships an unused `FileDropZone` for the `.md` drop): a title field + a large
textarea (paste markdown) + optional `.md` file drop → builds
`{ kind: "brainstorm", title, turns: [{ id, author: "Imported", content }] }` →
**await** `addLayer`; close only on success, show the error inline on failure.
Lossless and deliberately dumb (no 2-agent auto-parsing).

### 6. Placement — the phase switcher

Resolved (locked-decisions table): **whole-shell swap**.

- "Architecture" = the existing 3-pane shell, untouched; "Plan" replaces the
  entire `ResizableLayout` below the Header with `PlanPhaseView`. (The
  alternative — a middle-pane view — would stack a second toggle next to the
  pane's existing visual/code `ViewToggle` and demote the "first-class phase"
  framing to a tab.)
- **URL home:** `?phase=plan` search param, the same pattern that already drives
  `?view=code` (`usePanelToggle` is generic by param name; the two params
  coexist). Phase survives reload/back.
- **Memo trap:** `ProjectWorkspaceLayout` is `React.memo`'d with a hand-picked
  comparator (`project-workspace-layout-equality.ts`) whose own comment
  documents the stale-render regression. Branch on phase **above** the memoized
  layout so the comparator never sees a new prop.
- **Genesis gating:** the same `ProjectWorkspace` serves brand-new unsaved
  projects (`ui.state.kind === "genesis"`), where there is no `SavedProject`
  for `addLayer` to target — and an unmatched id is a **silent no-op** in the
  hook, so a pasted session would just vanish. The toggle and "Add planning
  session" are hidden unless `kind === "edit"` with a non-empty `projectId`
  (precedent: the governance panel's `enabled={isEditing}`).
- **Mobile:** `MobileLayout` hard-codes exactly 3 tabs (wizard / preview / ai).
  The phase toggle lives in the Header at both breakpoints; in Plan phase on
  mobile, render `PlanPhaseView` full-screen under the Header (no tabs).

### 7. Import capture — close the motivating flow

The flagship Vellum flow ends on the pre-save accept view, and layers can only
attach to a _saved_ project — so v1 as originally cut left the user to discover
a silent two-step (save, then find the Plan phase, then paste). Cheap fix while
the data is in hand: when the accept view saves and the imported spec text is
still available (the import flow holds it until save), offer to attach it as an
initial `"Imported"` layer in the same save. At minimum, the Plan phase empty
state on first open after an import nudges "Add the planning session that
produced this manifest?".

> **The seam (revised by review — the original callout named the wrong seam):**
> do **not** thread `saved.layers` through `ActiveWorkspaceContext`. That
> context is a whole-value localStorage snapshot (quota errors silently
> swallowed, no listener notification on failed writes) copied at three sites,
> none of which re-run after a layer mutation — threading layers would duplicate
> the full transcript into localStorage and go stale on the first `addLayer`.
> The seam carries **`projectId` only**: `useProjectLifecycle` already resolves
> the live saved record from its own `useSavedProjects` instance
> (`loadedProject` via `loadSavedProject(projectId)`) — `PlanPhaseView` reads
> `layers` there and mutates through that same instance (step 3).
> `ActiveWorkspaceContext` is untouched.

---

## Verification

- **Unit** — `normalizeLoadedProjects`: salvage policy (turn without usable
  `content` dropped; bad `author`/`at`/`id` defaulted, project preserved; `[]`
  default pinned on **both** push paths); the v4 migration (stamp + verify
  read-back; pre-v4 record loads clean); `addLayer` round-trip **and failure
  path** (write fails → caller informed, modal-stays-open contract); **clobber
  regression**: add a layer, then run the wizard autosave from the same
  workspace — the layer survives; genesis gating (toggle hidden, `addLayer`
  unreachable without a real `projectId`); `PlanTurnList` render (multi-author
  fixtures, markdown, empty state).
- **Regression** — the manifest import / accept / preview path is untouched;
  `layers` is additive and optional on the shared type. Confirm a pre-v4 project
  loads clean with `layers` defaulted.
- **Manual** — open a saved project → Plan phase → paste the Vellum session →
  reload → the session persists and renders as turns next to the manifest; then
  click Next in the wizard and reload again — the session is still there.

---

## Out of scope for v1 (the cut)

In-app live brainstorming · LLM decision-extraction · auto-parsing unlabeled
transcripts · manifest-as-layer refactor · a provenance graph · cross-project
planning search · adapter-level read-merge-write + cross-tab sync
(BroadcastChannel) — the last two are Phase-3 preconditions, noted in the
interactive-sessions design. All Phase 2/3.

---

## Related

- [project-planning-layers-interactive-sessions](./project-planning-layers-interactive-sessions.md)
  — the Phase-3 interactive design (the app runs the brainstorm and feeds the
  manifest pipeline).
- [migration-storage-hardening](./migration-storage-hardening.md) — the
  IDB/localStorage migration groundwork this v4 step builds on.
- [staged-generation-baseline-findings](./staged-generation-baseline-findings.md)
  and `packages/agentic-interaction/src/application/use-cases/staged-generation/`
  — the staged generation the Phase-3 "Finalize → generate manifest" step would
  call.
- Governance-chat arc — PRs #391–#402 (no repo doc; code:
  `apps/web/app/api/llm/chat/route.ts`, `apps/web/components/chat/`).
- `apps/web/features/manifest-generation/` — the accept-flow manifest preview
  (`ManifestPreview`); the workspace's own middle pane is
  `ArchitecturePreviewPane`.
- `components/chat/ChatMarkdown.tsx` — the markdown renderer the Plan phase
  builds `PlanTurnList` on.
