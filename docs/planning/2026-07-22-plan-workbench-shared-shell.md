# Plan Workbench — porting the `/projects/new` shell to `phase=plan` as a shared 2-column view

**Date:** 2026-07-22 · **Status:** v3 — **decisions locked** (Martin,
2026-07-22, §5); critique-revised (33-agent adversarial pass: 26 findings
integrated, 2 refuted). Ready for Phase 0 / PR A1.
**Related:** ADR-0045 (project planning layers), PRs #403–#405, #414–#416

## 1. Goal & requirements

Port the `/projects/new` application shell to the `phase=plan` views, as a
**shared view** with `/projects/new/ai`, so the brainstorming experience is
consistent whether the user is creating a project (genesis) or planning inside
a saved one.

Requirements (Martin, 2026-07-21/22):

1. Two-column layout. Left column reuses/resembles the project-wizard left
   column, but **without steps**.
2. Left column holds the wizard **step-1 fields**: workspace name, description,
   namespace, template, package manager, naming conventions.
   - 2a. That section is **collapsible** (accordion; reuse existing accordion
     components if available).
   - 2b. A **secondary accordion** lists all associated chats and/or sources
     (e.g. md files).
3. Right column is the **main content area** showing the full contents of the
   resource the user is interacting with.
   - 3a. Right column has a **text input area** — the LLM chat input box.
4. The re-used shell on `phase=plan` shares the **same footer** as `/projects/new`.
   - 4a. The **"Add planning session"** button moves to the **left-column footer**.
   - 4b. The "Add planning session" **modal is removed**; its contents render
     **inline in the right column** when the button is clicked.

## 2. Current state (verified seams)

- **`/projects/new` shell:** `apps/web/features/landing/ProjectsShell.tsx` — a
  `Card` with a header strip, scrollable `CardContent`, and a `footer` slot
  (`flex justify-between`, left | right). Genesis pages use
  `ProjectsShellWithFreeTier` (model badge + free-tier modal; degrades to the
  plain shell when no model is known — `FreeTierProvider` is app-wide,
  `app/layout.tsx:69`).
- **Plan phase today:** whole-shell swap (ADR-0045 D6). `ProjectWorkspace.tsx:66`
  gates it (`canUsePlanPhase`); `:174` computes `planPhaseActive`.
  `PlanPhaseView.tsx` is a single centered column: header + "Add planning
  session" button, `LiveSessionSection` (rendered unconditionally — it owns the
  seed form, interrupted-session banner, active-session panel, and finalize
  flow), archived `PlanLayerCard` list, `AddPlanningSessionDialog`, and a
  delete-confirm `Dialog`. The active session's layer is filtered out of the
  archive list (`PlanPhaseView.tsx:103-107`) — that structural exclusion is the
  only thing preventing mid-run deletion.
- **⚠ There is no watch-based wizard autosave.** The only `updateProject`
  writes during editing are `handleNext` and `handleSaveAndNew`
  (`useProjectLifecycle.ts:159-183, 225-246`) — step-navigation triggers that a
  stepless workbench never fires. The reload guard tracks Monaco buffers, not
  form dirtiness. **Plan-phase field persistence is new work (§3.2).**
- **Live session engine:** `usePlanningSession` requires a saved `projectId`
  (`start()` false at usePlanningSession.ts:294, `runLoop` exits at L186);
  genesis cannot run sessions by design (ADR-0045 Q4/D6). The hook owns only
  the loop; **finalize UI state, distill abort ref, seed/steering text live in
  `LiveSessionSection` local state** (LiveSessionSection.tsx:37-41, 82-100).
- **Wizard left column:** step-1 = `IdentityFields` (name / description /
  namespace), `TemplateSelector`, `PackageManagerSelect`,
  `NamingConventionsFieldset`. The form instance (`useWizardForm`) is owned by
  `WizardLifecycleProvider` — above the phase branch; `WizardStepFormProvider`
  is a pure context re-mount (`WizardLifecycleContext.tsx:52-64,83`), so
  widening it to plan phase shares one instance safely.
- **Layout machinery:** `DesktopLayout` hard-codes 3 panels (autosave id
  `hexagen-workspace-layout-v1`); the wizard switches to a **tabbed
  `MobileLayout`** via `useBreakpoint` (`ResizableLayout.tsx:35-56`). Plan phase
  today is a single column — it has no mobile problem; a 2-pane layout creates
  one (§3.1). `ProjectWorkspaceLayout` is `React.memo` with a hand-picked
  comparator (`project-workspace-layout-equality.ts:17-56`) — new state must be
  subscribed _inside_ the plan host, never threaded through layout props
  (documented trap: `DerivedFromPlanLink.tsx:14-19`).
- **Accordion:** no shared primitive; two local implementations
  (`QuestionAccordion`, `PlanLayerCard` collapse).
- **Chat primitives:** `ChatComposer` clears its draft _before_ `onSubmit` and
  disables input while streaming (ChatComposer.tsx:30-36,48) — both wrong for
  session semantics (§3.3).
- **Genesis manifest identity:** the generated YAML has **no governance
  section**; `manifest-parser.ts:178-200` derives governance from top-level
  `system`/`scope`/`architecture`/`description` and hardcodes the rest
  (packageManager, namingConventions). `handleUseManifest` already keeps
  formState↔manifestYaml agreement for system/scope via `setManifestIdentity`
  (AIGenerationPage.tsx:47-57).
- **#414 kind normalizer:** unknown layer kinds are **coerced to `brainstorm`**
  on import (not dropped) — a new "source" kind would be silently corrupted,
  not lost, until the whitelist is extended.

## 3. Design

### 3.1 Shared component: `PlanWorkbench`

One presentational workbench, two hosts (plan-phase, genesis). Hosts own all
data via adapter props; **no `useWizardLifecycleContext` inside shared code**.

- **Layout:** new `TwoPaneLayout` (react-resizable-panels; own autosave id
  `hexagen-plan-workbench-v1`; `DesktopLayout` is not reusable — it hard-codes
  3 panels and its persisted layout is keyed to them). Left pane: `Card` →
  `PanelHeader` → scrollable content → **left footer** (`shrink-0 border-t`)
  holding "Add planning session". Collapsible via `usePanelCollapse` +
  `CollapsedStrip`. Right pane: main view + composer pinned bottom.
- **Shell:** the workbench mounts inside **`ProjectsShellWithFreeTier`** in
  _both_ hosts (critique: plain `ProjectsShell` in plan phase would drop the
  model badge exactly where sessions consume quota; the badge self-degrades).
  In `phase=plan` the app `Header` (with `PhaseToggle`) stays above it, as on
  `/projects/new/*`. Chrome detail: the workspace main has no page padding and
  the left pane is a Card-in-Card — PR A resolves with a flat left pane
  (border-r instead of nested Card).
- **Mobile (<md):** **tabbed, following the existing `MobileLayout` precedent**
  (decided, §5 Q6 — not ManifestPreview's overlay, not stacked disclosure:
  stacking produces two scroll regions where the composer gets pushed below a
  long left pane, the exact failure req 3a exists to prevent; tabs give the
  composer a guaranteed visible home and reuse the wizard's own mobile
  pattern): tabs `Plan | Session`, left-column content under "Plan", main view
  - composer under "Session", composer pinned bottom, and the "Add planning
    session" button rendered as a fixed footer below both tabs (not hidden
    inside a disclosure). Explicit acceptance item of PR A2.

### 3.2 Left column

- **Accordion primitive first:** `Accordion` compound
  (`Root/Item/Trigger/Content`) in `@hexagen/ui`, modeled on the `Tabs`
  compound; chevron pattern from `QuestionAccordion`. (Migrating existing
  ad-hoc collapses is a non-goal.)
- **Section A — "Project settings" (req 2, 2a):** the step-1 field components
  verbatim, no `StepHeader`/`WizardFooter`/step chrome (req 1).
  - **phase=plan:** mount `WizardStepFormProvider` around the plan-phase tree —
    same form instance (owned above the phase branch). **Persistence is new
    work:** a debounced-on-change + flush-on-blur watcher in the plan host
    calling the D5 read-merge-write port (`updateProjectRecord`) for the
    governance fields, plus a flush on phase switch and a `beforeunload` flush.
    (The critique's sharpest finding: without this, edits silently never
    persist — the "wizard autosave" is step-navigation-only.)
  - **genesis:** a small genesis form (`useForm<ProjectConfig>` seeded from
    `?name=` + defaults) **backed by a module store** so values survive the
    accept Back/Regenerate round trip (critique: component state alone is lost
    on that round trip; `usePendingManifest` is cleared on those paths).
    Reconciliation (decided, §5 Q5): name/namespace flow through the
    **existing `setManifestIdentity` top-level rewrite** in `handleUseManifest`
    (keeps the documented formState↔manifestYaml agreement); packageManager /
    namingConventions / template exist only in formValues (the YAML has no
    governance section — nothing to diverge). **Guardrail: do NOT invent a
    governance section in the genesis YAML** to "round out" the form — that is
    a manifest-schema change disguised as a UI task and needs its own ADR. The
    agreement stays limited to fields that already have a YAML home.
- **Section B — "Sessions & sources" (req 2b):**
  - **phase=plan:** live session pinned first (status chip), archived layers
    newest-first (title, kind badge, turn count, updatedAt, produced-manifest
    badge). Selection = `?layer=<id>` **via `router.replace`** (not
    `usePanelToggle`'s push — no history spam), **read with `useSearchParams`
    inside the plan host** (never through `ProjectWorkspaceLayout` props — memo
    comparator trap). Unknown/stale/deleted id → fall back to the live view
    and clean the param; a loading state covers the async projects load.
  - **genesis:** "Draft brief" row + read-only "Source" row from
    `usePendingManifest.originSpecText` when present. No layers pre-save; the
    Section B empty state renders a muted "Planning sessions are available
    after you save" line (decided, §5 Q1 — the hint lives here, never as a
    disabled footer button).
  - **"Sources" v1** (decided, §5 Q4) = imported-transcript layers + pending
    origin spec only. First-class md source documents are **out of scope**: a
    new kind needs the #414 whitelist extension **and the coercion-to-
    brainstorm guard fixed first** (today an unknown kind is _corrupted_, not
    rejected), plus an ADR amendment defining what a non-session source means
    in the layer model. Named as a known v1 gap — building it half-way is
    worse than not building it.
- **Left footer (req 4a):** "Add planning session" button. **phase=plan only —
  hidden in genesis** (decided, §5 Q1: a disabled button is a negative
  affordance signaling a feature that's "almost there" when it's Phase 3 + an
  ADR amendment away; hiding keeps the slot honest and the shell visually
  matched to `/projects/new`). The empty main view keeps a secondary "Add an
  existing transcript" action (critique: today's empty state pitches
  transcript import; req 4a is about the button's primary home, not
  exclusivity).

### 3.3 Right column (req 3, 3a, 4b)

View-state union — revised after critique so the session lifecycle is one
view, not two:

```ts
type WorkbenchMainView =
  | { kind: "live" } // WHOLE session lifecycle: seed form
  // (no session), interrupted-session
  // banner, active session, done +
  // "start another". Default view; also
  // where a zero-layer project lands.
  | { kind: "layer"; layerId: string } // full contents of an archived layer
  | { kind: "add-session" }; // inline add-session view (4b)
```

- **`live`:** `LiveSessionSection`'s content restyled full-height. **State
  ownership must move before the layout does:** finalize UI state, the distill
  abort ref, and seed/steering drafts lift out of `LiveSessionSection` local
  state into `usePlanningSession` (or a workbench-level container). Otherwise
  switching views mid-finalize aborts the distill, discards edited review
  text, and soft-locks the session in `finalizing` (recovery only exists via
  `attach()`, unreachable while the hook holds state). **Acceptance test —
  written into PR A2's test plan NOW as a named vitest case, not deferred
  (Martin, 2026-07-22: the single highest-value regression guard for the
  state lift):**
  `it("retains finalize review text and phase when the main view switches away and back mid-finalize")`
  in `plan-phase/PlanWorkbench.test.tsx` (node:assert/strict house style) —
  start finalize → reach `review` with edited text → switch to a `layer` view
  → switch back → review text and finalize phase intact, no `cancelFinalize`
  fired. `usePlanningSession` stays mounted at the workbench host; view
  switches never unmount the loop.
- **`layer`:** full-height reader — header (title, rename, kind badge,
  Extract decisions / View architecture / Delete) + full `PlanTurnList`.
  **Read-only in v1** (decided, §5 Q3: an archived layer is a finalized
  artifact — appending manual turns would silently break the
  "layer = a session's distilled output" mental model and muddy the
  produced-manifest provenance D7 cares about; `appendLayerTurn` existing ≠
  it being safe in this UX; manual notes would be a new kind → Q4, deferred).
  The **delete-confirm `Dialog` stays** (so the jsdom
  `<dialog>` test quirk only shrinks, it doesn't vanish). Guards ported from
  today's structural exclusion: `?layer=` equal to the active session's layer
  **normalizes to the `live` view**, and Delete is hidden for a session-backed
  layer (critique: otherwise a deep link + mid-run delete orphans the loop and
  destroys the only copy of the turns).
- **`add-session` (4b):** `AddPlanningSessionView` — the dialog contents
  (title input, transcript textarea, `FileDropZone`, split-by-`## Author`
  checkbox, inline error) as a right-column page with Cancel / Add. On
  success: select the new layer. `AddPlanningSessionDialog.tsx` deleted; tests
  move.
- **Composer (3a):** new `TextareaComposer` — **specified by contract, not by
  analogy to `ChatComposer`** (critique): `onSubmit: (text) => Promise<boolean>`
  with clear-only-on-resolve-true (a failed `session.start()` must not eat the
  brief); no input-disable while the loop streams (steering is legal at any
  point); no Stop affordance (session control lives in the toolbar). Modes:
  - `live`+no session: seed → `start(seed)`; caption carries the **ADR-0045 Q5
    quota copy** ("each round uses 2 AI chat requests…"), which the deleted
    seed box carried before.
  - `live`+active: steering → `addSteering(text)`; same Q5 caption.
  - `layer` / `add-session`: hidden. (Critique verdict: this does not violate
    req 3a — the input is a right-column fixture of the interaction views.)
  - **genesis:** submit routes through **`handleGenerate`** — not
    `generateManifest` directly — preserving min-length validation, the
    local-generation warning dialog, and the `/models` detour (§3.6).

### 3.4 Shell footer (req 4)

Same `ProjectsShellWithFreeTier` footer slot in both hosts:

- **genesis:** unchanged (Back | Next-after-generation).
- **phase=plan:** **empty-until-converged, no permanent Pause/Resume/End**
  (decided, §5 Q2: session lifecycle controls belong with the session view —
  shell-footer controls would have to describe a session the user may have
  navigated away from in `?layer=`, reopening the state-ownership trap §3.3
  just closed; empty-until-converged also matches genesis, whose footer is
  genuinely conditional, satisfying req 4 at the slot level). Right side
  shows "Finalize → Generate manifest" when the session is `converged` —
  **possible only because §3.3 lifts finalize state to the workbench level**
  (it is component-local today). Left side empty (PhaseToggle stays in the
  Header per D6). A pause/resume affordance, if ever wanted, goes in the
  live-view toolbar later — not smuggled in here.

### 3.5 What explicitly does NOT change

- ADR-0045 D6 gating: `?phase=plan` requires a saved project; genesis never
  mounts live sessions in v1.
- The finalize → import → accept-save handoff (sessionStorage rehydration,
  `setOriginSession`, `sessionMatchesSpec` stamping, `deriveInitialLayers`,
  and the deliberate no-stamp-at-confirm invariant).
- Saved-project schema and layer kinds. (Genesis identity reconciliation in
  §3.2 uses the _existing_ `setManifestIdentity` rewrite inside
  `handleUseManifest` — the handoff contract itself is untouched.)
- The wizard's 3-pane `DesktopLayout` and step router.

### 3.6 Genesis controls (Phase 2 spec — was the plan's biggest gap)

Everything `/projects/new/ai` renders needs a stated home:

| Today (GenerateWithAi)                                                   | Workbench home                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| `DescriptionInput`                                                       | the composer (§3.3)                                      |
| `ExampleCardsSection`                                                    | main `live`-equivalent view body, above the composer     |
| `AdvancedOptionsSection` (deployment, maxContexts, engine, change-model) | third left-column accordion section "Generation options" |
| `ModelSetupPrompt`, capability warning, error/retry                      | main view body (state-dependent), as today               |
| `LocalGenerationWarningDialog`, `/models` detour, min-length gate        | kept — composer submit routes through `handleGenerate`   |
| `AiGeneratingStep` telemetry                                             | main view during generation                              |

`/projects/new/ai/accept` and `/models` keep their current shells (out of
scope; revisit after Phase 2 ships).

## 4. Phased delivery

**Phase 0 — primitives (1 PR):** `Accordion` compound; `TextareaComposer`
(contract per §3.3); `TwoPaneLayout` + left-footer pattern + mobile tabs.
Pure additions, unit-tested.

**Phase 1 — phase=plan port (3 PRs, was 2 — critique: "PR A" bundled four
independently risky changes):**

- **PR A1 — form seam:** widen `WizardStepFormProvider` to the plan-phase
  tree; Section A fields; the **new debounced D5-port persistence** +
  phase-switch/beforeunload flush. Independently testable against the
  existing `PlanPhaseView`.
- **PR A2 — workbench layout:** `PlanWorkbench` + sessions accordion + view
  union + **session/finalize state lift** + composer + shell/footer + mobile
  tabs. `PlanPhaseView` becomes the wiring host. **Test plan includes, by
  name (locked, §3.3):**
  `it("retains finalize review text and phase when the main view switches away and back mid-finalize")`
  — the state-lift regression guard; PR A2 does not merge without it.
- **PR B — 4b + selection:** `AddPlanningSessionView` inline (dialog
  deleted), `?layer=` deep-linking (replace semantics, stale-id fallback,
  live-layer normalization, Delete guard), empty-state secondary action.
- Test blast radius (verified): `PlanPhaseView`, `LiveSessionSection`,
  `AddPlanningSessionDialog` suites rewritten across A2/B.

**Phase 2 — genesis adoption (2 PRs, was 1 — underscoped):**

- **PR C1:** mount the workbench at `/projects/new/ai`; genesis form + module
  store; Section B draft/source rows; composer → `handleGenerate`; telemetry
  as main view; footer unchanged.
- **PR C2:** relocate Generation-options accordion + example cards + setup
  prompts per §3.6; identity reconciliation (`setManifestIdentity` extension);
  Back/Regenerate round-trip persistence.

**Phase 3 — deferred (needs ADR amendment; NOT this arc):** genesis live
sessions via a pending-session store folded into `initialLayers` at
accept-save. Note the critique's caution: a sessionStorage-persisted pending
store re-introduces the abandoned-provenance leak class D7 was decided
against — design the TTL/cleanup story first.

## 5. Decisions — LOCKED (Martin, 2026-07-22)

All six open questions answered; rationale recorded here so it isn't
relitigated during review. The design sections above reference these as
"§5 Q_n".

1. **Genesis left footer: HIDE "Add planning session".** A disabled button is
   a negative affordance signaling a feature that's almost there — it isn't
   (Phase 3 + ADR amendment). Hiding is honest and keeps the left-footer slot
   empty so the shell still visually matches `/projects/new` without a ghost
   control. The hint, if any, is a muted "Planning sessions are available
   after you save" line in the Section B empty state — never in the footer.
2. **Shell footer in phase=plan: empty-until-converged; no permanent
   Pause/Resume/End.** Session lifecycle controls belong with the session
   view — shell-footer controls would describe a session the user may have
   navigated away from in `?layer=`, reopening the state-ownership trap §3.3
   closed. Empty-until-converged matches genesis (whose footer is genuinely
   conditional), satisfying req 4's "same footer" at the slot level. Any
   future pause/resume affordance goes in the live-view toolbar.
3. **Archived layers: read-only in v1.** `appendLayerTurn` existing ≠ it being
   safe in this UX. An archived layer is a finalized artifact; appending
   manual turns silently breaks the "layer = a session's distilled output"
   mental model and muddies the produced-manifest provenance ADR-0045 D7
   cares about. Manual notes would be a new kind (see Q4), not a mutation of
   an archived session layer. Deferred.
4. **"Sources" v1: imported-transcript layers + pending origin spec only.**
   First-class md documents correctly deferred: a new kind needs the #414
   whitelist extension **and the coercion-to-brainstorm guard fixed first**
   (today an unknown kind is corrupted, not just rejected), plus an ADR
   amendment for what a non-session source even means in the layer model.
   Called out as a known v1 gap — building it half-way is worse than not
   building it.
5. **Genesis identity merge: name/namespace via the `setManifestIdentity`
   rewrite inside `handleUseManifest`; packageManager / namingConventions /
   template are formValues-only.** The YAML genuinely has no governance
   section (`manifest-parser.ts:178-200` derives from top-level fields and
   hardcodes the rest) — nothing to diverge from. **Do not invent a
   governance section in the genesis YAML** to "round out" the form: that's a
   manifest-schema change disguised as a UI task and needs its own ADR. The
   formState↔manifestYaml agreement stays limited to fields with a YAML home.
6. **Mobile: tabbed (`MobileLayout`-style).** Stacked disclosure produces two
   scroll regions where the composer — the thing the user came for — gets
   pushed below a long left pane: the exact failure mode req 3a exists to
   prevent. Tabs give the composer a guaranteed visible home in the "Session"
   tab, keep "Add planning session" as a fixed footer below both tabs, and
   match the wizard's own mobile precedent so users don't learn a second
   mobile pattern.

## 6. Risks

- **New persistence path** (plan-phase field edits) is the highest-risk piece:
  debounce + flush + D5 port; verify the live code path before editing the
  `ProjectWorkspace` seam (house rule); acceptance test = edit in plan phase →
  reload → value persisted.
- **Finalize/session state lift** changes `usePlanningSession`'s ownership
  surface — the generation-ref/abort semantics must survive; add the
  switch-away-and-back finalize test before restyling.
- **Dual-host divergence:** workbench stays presentational; hosts own data.
- **Memo comparator trap:** all new URL/selection state subscribed inside the
  plan host.
- **Test churn:** three suites rewritten; budgeted in A2/B.
