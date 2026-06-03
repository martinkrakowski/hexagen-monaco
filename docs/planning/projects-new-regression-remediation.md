# `/projects/new` Regression Remediation Plan

Remediation for five regressions/defects in the project-creation flows (AI +
import). Each phase is a standalone PR off `main`, ordered by severity and
independence. References use durable locators (file + symbol / search hint), not
line numbers.

**Review status:** validated by three independent reviews (root causes confirmed
via direct inspection + repro). Their gaps are folded in below — notably the
per-enum normalization _direction_ (PR 1), the full 4-caller audit (PR 2), and
the flexbox/server-component details (PR 3).

## Summary

| PR       | Phase | Items                                                  | Severity              | Blast radius            |
| -------- | ----- | ------------------------------------------------------ | --------------------- | ----------------------- |
| **PR 1** | P0    | #4 manifest parse case-sensitivity                     | High (blocks AI flow) | schema (1 file)         |
| **PR 2** | P0    | #2 approval not persisted + #1 import file not cleared | High (data loss)      | hook + **4 call sites** |
| **PR 3** | P1    | #5 model missing from toolbar                          | Medium (UX)           | shell + 3 screens       |
| **PR 4** | P2    | #3 redundant drag-drop on AI screen                    | Low (cleanup)         | AI screen only          |

PR 1 and PR 2 are the priority — both P0, independent, and together they restore
a working _generate → approve → persist_ path (`#4` blocks before approval;
`#2` + `#1` lose it after). PR 2 has the widest blast radius.

---

## PR 1 — Manifest parse must tolerate enum casing (item #4) · P0

**Root cause.** `BoundedContextTypeSchema` in `@hexagen/project-configuration`
(`domain/model/manifest-schema/manifest-schema.ts`) is a case-sensitive
`z.enum(["core","supporting","generic","shared-kernel","driver"])`. When the LLM
emits a capitalized value (e.g. `"Core"`), `parseManifestToWizardData`
(`@hexagen/wizard-orchestration`, `manifest-parser.ts`) fails at
`ManifestSchema.safeParse(...)` and throws `Manifest validation failed: Invalid
enum value…`, on **"Use This Manifest"** (`AIGenerationPage.handleUseManifest`,
`ImportProjectSpecPage.handleAcceptAndContinue`, and `ImportManifestPage` via
`useManifestParser`). Repro confirmed against the built schema:
`type: "Core"` → error, `type: "core"` → success.

Generation already tolerates casing via `coerceContextType`
(`@hexagen/agentic-interaction`, `coerce-raw-topology.ts`, case-insensitive,
tested with `"Core"`), but the **project-configuration parse path used at
approval does not** — that mismatch is the bug.

**Fix.** Normalize casing at the schema boundary in `manifest-schema.ts` with a
small case-insensitive enum helper, applying the **correct direction per enum**
(verified values):

| Schema                                                   | Canonical casing | Normalize    |
| -------------------------------------------------------- | ---------------- | ------------ |
| `BoundedContextTypeSchema` (`core`…`driver`)             | lower            | **lower**    |
| `RelationshipPatternSchema` (`U/D`,`ACL`,`SK`,`P`,`OHS`) | UPPER            | **UPPER** ⚠️ |
| `RelationshipRoleSchema` (`upstream`…)                   | lower            | lower        |
| `PlaneTypeSchema`                                        | lower            | lower        |
| `StatusTypeSchema`                                       | lower            | lower        |
| `LayerTypeSchema`                                        | lower            | lower        |

⚠️ `RelationshipPatternSchema` is ALL-CAPS — it must be **upper-cased**, not
lower-cased (a blanket `.toLowerCase()` would break it). Use a helper like
`ciEnum(values, "lower" | "upper")` wrapping `z.preprocess` so the direction is
explicit per enum. Minimum viable scope is `type` + `RelationshipPattern` +
`RelationshipRole` (the three the LLM realistically varies); applying to all six
is low-risk and prevents future surprises.

**Known drift (flag, defer).** The bounded-context-type enum is duplicated in
`@hexagen/shared` (`manifest-draft.schema`) and in
`classify-context-type.use-case.ts`, and **both are missing `"driver"`**. A
manifest with `type: "driver"` validated against those would still fail. The
`manifest-schema.ts` preprocess fixes the reported flow; the drift is a separate
regression risk — flag it as a follow-up (reconcile the enums / share one
source), not part of PR 1.

**Files.** `packages/project-configuration/src/domain/model/manifest-schema/manifest-schema.ts`.

**Tests.** `@hexagen/wizard-orchestration` `manifest-parser.test.ts`: a manifest
with `type: Core` parses and normalizes to `core`. Schema unit tests: mixed-case
`type` accepted (→ lower) and mixed-case relationship `pattern` accepted (→
upper).

**Risk.** Low — preprocess only changes string casing; canonical values are
unaffected. Confirm nothing depends on the schema _rejecting_ mixed case.

**Acceptance.** Generating with capitalized context types → "Use This Manifest"
succeeds; no casing-related `Manifest validation failed`.

---

## PR 2 — Persist approved project reliably + clear import file (items #2, #1) · P0

**Root cause (#2, regression).** Saved projects moved from synchronous
localStorage to **asynchronous IndexedDB** (`IDBSavedProjectsAdapter`,
idb-keyval, introduced in `7b9acd0a`). The migration was intentional, but the
call sites weren't updated. `useSavedProjects.saveProject`
(`apps/web/app/hooks/useSavedProjects.ts`) does an optimistic in-memory add and
fires `port.saveProjects(...).then(revert-on-fail)` **without awaiting**,
returning the id synchronously. `ManifestAcceptPage.executeSave` then
**immediately** `pendingManifest.clear()` and `router.push("/wizard/1?project=ID")`,
racing the uncommitted IDB write (and on write failure the optimistic add is
reverted in the now-unmounted hook). Net: the approved project isn't there →
"reverts to the previous state."

**Root cause (#1).** `ImportProjectSpecPage` stores the uploaded spec in
`sessionStorage["import_spec_content"]` and re-hydrates it on mount. It's cleared
on Back / Start Over / Cancel, but **not** on `handleAcceptAndContinue` (the
approve→save path), so the next visit re-loads the stale file.

**Fix.**

- Make persistence awaitable: change `useSavedProjects.saveProject` to return
  `Promise<string | null>` that `await`s `port.saveProjects(...)` and resolves
  the id only after commit (or `null` + `persistError` on failure). Keep the
  optimistic state update for instant list feedback. Update the **`!mounted`
  stub** (currently `saveProject: () => ""`) to return a resolved `Promise`, and
  update any typed interface that declares the sync signature (e.g.
  `useProjectGenerationFlow`'s `options.saveProject`).
- **Caller audit — all 4 sites need await-and-guard** (the signature change makes
  TS flag the consumers, which assign `const projectId = saveProject(...)`):

  | Caller                                    | File                                                | Action                                                                                                                                                    |
  | ----------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `ManifestAcceptPage.executeSave`          | `manifest-generation/ManifestAcceptPage.tsx`        | `await`; on success clear pending + `sessionStorage.removeItem("import_spec_content")` (fixes #1) + navigate; on failure show `saveError`, don't navigate |
  | `ImportManifestPage.handleAccept`         | `manifest-generation/ImportManifestPage.tsx`        | `await` + guard before navigate (same race)                                                                                                               |
  | `usePathNavigation.navigate` (blank path) | `landing/application/usePathNavigation.ts`          | `await` + guard before navigate (same race)                                                                                                               |
  | `useProjectGenerationFlow.execute`        | `workspace-shell/hooks/useProjectGenerationFlow.ts` | lower priority — doesn't navigate but sets active workspace before commit; set active workspace **after** the promise resolves                            |

**Files.** `apps/web/app/hooks/useSavedProjects.ts`, `ManifestAcceptPage.tsx`,
`ImportManifestPage.tsx`, `usePathNavigation.ts`, `useProjectGenerationFlow.ts`
(+ its options type).

**Tests.** `useSavedProjects` — `saveProject` resolves after the IDB write
commits, and resolves `null` + sets `persistError` on port failure (mock the
persistence port). Optionally assert `executeSave` does not navigate until the
write resolves.

**Risk.** Medium — sync→async signature ripples to 4 callers + the stub + typed
interfaces. Reproduce the race (approve → wizard with project present) before and
after to confirm.

**Acceptance.** Approving an AI or import project → it appears in saved projects
and the wizard loads it every time; starting another new project shows a blank
import screen.

---

## PR 3 — Always show the current model in the toolbar (item #5) · P1

**Root cause.** The model badge is rendered only by `ProjectsShellWithFreeTier`
(via its `title` path, not custom `headerContent`) or inline in
`ImportProjectSpecPage`. Screens using the plain `ProjectsShell` with custom
`headerContent` — `AIGenerationPage`, `ManifestAcceptPage`, `ModelSelectionPage`,
`ImportManifestPage` — render no model. `FreeTierProvider` wraps the whole app in
`apps/web/app/layout.tsx`, so `useFreeTier` is available everywhere.

**Fix.**

- Render the model badge centrally in `ProjectsShell`
  (`apps/web/features/landing/ProjectsShell.tsx`) via `useFreeTier`, placed at the
  **trailing edge of the toolbar, independent of `headerContent`**. Lay out the
  header as `flex items-center justify-between gap-4`, wrap `headerContent` in a
  `flex-1 min-w-0` region, and render the badge as a trailing sibling so it can't
  overlap header content on small viewports.
- `ProjectsShell` becomes a client component (`"use client"`) because of the
  hook. **Verify no server-only content** is passed through its
  `children`/`headerContent`/`footer` by its ~7 importers (all current consumers
  are client or pass client-rendered children, so this should be safe — confirm).
  If the server→client conversion proves risky, the fallback is a separate
  `<ModelBadge />` client component composed into each page's `headerContent`.
- After centralizing: switch the two `ProjectsShellWithFreeTier` call sites to
  plain `ProjectsShell` (or keep a thin alias), and remove the inline badge in
  `ImportProjectSpecPage`. Expect minor adjustments to `renderHeaderContent` in
  `AIGenerationPage` and `ManifestAcceptPage` so their right-aligned tabs compose
  cleanly with the trailing badge; verify on tabbed screens and title-only
  screens (`ModelSelectionPage`, `ImportManifestPage`).

**Files.** `ProjectsShell.tsx`, `ProjectsShellWithFreeTier.tsx`,
`ImportProjectSpecPage.tsx` (+ light touches to the two `renderHeaderContent`
sites if needed).

**Tests.** Render test: `ProjectsShell` inside a `FreeTierProvider` reporting a
model shows the badge, with and without custom `headerContent`. Manually verify
each `/projects/new/*` screen.

**Risk.** Medium — server→client conversion (main risk) + header layout with
tabbed screens.

**Acceptance.** Every `/projects/new/*` screen shows the current model in the
toolbar.

---

## PR 4 — Remove redundant drag-drop YAML from the AI screen (item #3) · P2

**Root cause.** `DescriptionInput` (rendered by `GenerateWithAi`, the AI screen)
includes a `FileDropZone` + filename badge that duplicates the dedicated import
section. (Other `FileDropZone` uses elsewhere are out of scope.)

**Fix.** Remove the `FileDropZone` and filename-badge UI from `DescriptionInput`;
drop its `loadedFileName` / `onFileLoaded` / `onClearFile` props; remove
`loadFromFile` / `loadedFileName` from `useGenerateWithAiForm` and the wiring in
`GenerateWithAi`. Keep the textarea, character counter, and AI-ready indicator.

**Files.** `GenerateWithAi/DescriptionInput.tsx`, `GenerateWithAi.tsx`,
`hooks/useGenerateWithAiForm.ts`.

**Tests.** Update `__tests__/DescriptionInput.test.tsx` — and fix its existing
prop-name mismatch (`onLoadFromFile` → the real `onFileLoaded`) while removing the
file-related assertions. In `__tests__/useGenerateWithAiForm.test.ts`, delete the
`loadFromFile` / `clearFile` cases.

**Risk.** Low — pure removal; confirm `GenerateWithAi` is the only consumer of the
form's file fields (it is).

**Acceptance.** The AI screen has no drag/drop; file import is only via the
dedicated import flow.

---

## Cross-cutting

- **Per PR:** branch off `main`; run `yarn workspace web typecheck`, eslint on
  changed files, the relevant tests, and the pre-commit hook (`turbo lint` +
  `turbo typecheck`); after port/adapter changes (PR 2) also build. Open the PR
  against `main`.
- **No brittle line numbers** in code comments or docs — use symbols / search
  hints (a prior review flagged this).
- **Validation:** the dev env is configured for OpenRouter, so exercise the full
  AI flow end-to-end (generate with mixed-case output → approve → wizard presence)
  to confirm the #2/#4 fixes on screen.
- **Sequencing:** PR 1 and PR 2 first (both P0, independent). PR 3 then PR 4.
- **Housekeeping:** the stray `a582b77c` ("docs(planning): slim apply-import plan
  to as-built notes") on `main` is confirmed pure docs with no code impact —
  **safe to leave**; revert only if you prefer a clean history.
- **Follow-up (not in these PRs):** reconcile the duplicated bounded-context-type
  enums (`@hexagen/shared`, `classify-context-type.use-case.ts` are missing
  `"driver"`); consider generation-side canonicalization so stored YAML is
  normalized at the source.
