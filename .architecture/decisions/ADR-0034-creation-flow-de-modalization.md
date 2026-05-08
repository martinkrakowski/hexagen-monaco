# ADR-0034: Creation Flow De-Modalization — Route-Driven Project Creation

**Status**: ACCEPTED (2026-05-07)

**Context**:

Project creation flows (AI generation, manifest import, blank project) were implemented as modal dialogs triggered from the `/projects` landing page and the workspace header. This created several problems:

1. **No URL for creation steps** — Users could not bookmark, share, or navigate directly to creation flows
2. **Modal infrastructure coupled to landing page** — `WelcomeManifestDialog`, `LoadManifestDialog`, and related draft/resume overlays were embedded in `ProjectsLandingShell`
3. **Draft system complexity** — A draft save/resume infrastructure existed for incomplete creation flows, adding state management overhead for data that was never persisted long-term
4. **Browser back-button broke flows** — Modal state was lost on navigation; no deep-linking possible
5. **Mobile UX degraded** — Modals are particularly problematic on small screens

**Decision**:

Replace all modal-based creation flows with first-class routed pages. Every user-facing step in the creation flow now has its own URL. Modal components and draft infrastructure are deleted entirely.

---

## Route Map

| Route                         | Renders                  | Purpose                                           |
| ----------------------------- | ------------------------ | ------------------------------------------------- |
| `/projects`                   | Project list             | List-only; empty state CTA → `/projects/new`      |
| `/projects/new`               | Method selection         | 3 CTAs: AI, Import, Start Blank                   |
| `/projects/new/ai`            | AI generation page       | Prompt input + streaming generation               |
| `/projects/new/ai/accept`     | Manifest review & accept | Preview generated manifest before saving          |
| `/projects/new/import`        | Import manifest page     | Single-page: file upload + paste + inline preview |
| `/wizard/[step]?project={id}` | Workspace shell          | Unchanged; destination after project creation     |

## Architectural Principles

1. **Every user-facing step has a URL.** The AI generation step, manifest review step, and import step are all independently addressable and bookmarkable.
2. **No modal infrastructure in creation flows.** `WelcomeManifestDialog` and `LoadManifestDialog` are deleted, not repurposed. Their content is promoted to page components.
3. **`/projects` is a list, nothing more.** It renders saved projects and a single "New Project" CTA. It has no knowledge of creation flows.
4. **`/projects/new` is the intent boundary.** It owns method selection and is the shared entry point whether the user arrives from the empty state or the header button.
5. **Inter-step state is ephemeral, not persisted.** The generated manifest YAML passed from `/projects/new/ai` to `/projects/new/ai/accept` lives in a short-lived Zustand slice (not localStorage, not IDB). It is cleared on accept, cancel, or page reload.

## Inter-Step State: `pendingManifest` Store

The AI generation flow requires passing a generated manifest from `/projects/new/ai` to `/projects/new/ai/accept`. This state must not be in the URL (YAML is too large) and must not persist across sessions (it is pre-save, ephemeral data).

**Mechanism:** A dedicated `usePendingManifest` Zustand slice with no persistence middleware.

```typescript
interface PendingManifestState {
  yaml: string | null;
  formValues: WizardFormValues | null;
  projectName: string | null;
  set: (
    yaml: string,
    formValues: WizardFormValues,
    projectName: string,
  ) => void;
  clear: () => void;
}
```

**Lifecycle:**

- Set by `/projects/new/ai` on successful generation before navigating to `/projects/new/ai/accept`
- Read and cleared by `/projects/new/ai/accept` on accept or cancel
- If a user navigates directly to `/projects/new/ai/accept` with no pending manifest, redirect to `/projects/new/ai`
- Resets on page reload (intended behavior — no persistence middleware)

## Auto-Save on Step Progression

When editing an existing project in the wizard, every step progression (`handleNext`) auto-saves via `useSavedProjects().updateProject(projectId, formValues, JSON.stringify(wizardToManifest(...)))`. This eliminates the need for a separate draft system — projects are first-class from creation and saved incrementally.

## Feature Isolation

The `hexagen-ui/no-feature-slice-imports` ESLint rule forbids cross-feature imports. This required several accommodations:

- **`blankProjectConfig` inlined** in `NewProjectPage.tsx` instead of importing `emptyFormValues` from `project-wizard/config.ts`
- **`FileDropZone` inlined** from `@hexagen/ui` in `ImportManifestPage.tsx`
- **`llmContext` passed as prop** from route page client component to `AIGenerationPage` to avoid `manifest-generation` importing `llm-driver`

## Deleted Infrastructure

The following were removed entirely:

- `WelcomeManifestDialog` — content promoted to `AIGenerationPage` + `ManifestAcceptPage`
- `LoadManifestDialog` — content promoted to `ImportManifestPage`
- `EmptyProjectsHero` — replaced by `NewProjectPage` at `/projects/new`
- Draft save/resume hooks, dialogs, overlays — auto-save on step progression replaces drafts
- `?welcome=true` query param logic — no longer needed; `/projects/new` is the canonical entry
- `onLoadSavedProject` from Header props — replaced by `/projects` route navigation
- `SavedProjectsSubmenu` flyout — replaced by direct `/projects` link

## Project Menu Updates

- "Saved Projects" changed from flyout submenu to direct `/projects` link
- "Sign in to GitHub" disabled with "Coming soon" tooltip
- "Download as ZIP" gated by `canExport` (requires active workspace)
- "Import Manifest" removed (now a route at `/projects/new/import`)

---

## Consequences

### Positive

- All creation flows are deep-linkable, bookmarkable, and shareable
- Browser back/forward navigation works naturally
- Mobile UX significantly improved (full pages instead of modals)
- Draft system complexity eliminated — auto-save on step progression is simpler
- `/projects` page is decoupled from creation logic
- State management simplified: one ephemeral Zustand slice vs. modal state + draft persistence

### Negative

- AI generation flow state is lost on page reload (user must regenerate) — this is acceptable because the generation is fast and the state is pre-save
- Import flow has no inter-step state, so reload loses file selection — acceptable for a single-page flow

### Neutral

- Route file structure adds 5 new page files under `apps/web/app/projects/new/`
- `pendingManifest` store is a new Zustand slice but has no persistence, so it adds minimal complexity

---

## What Did Not Change

- `apps/web/app/wizard/layout.tsx` and `useProjectSearchParam` — unchanged
- `useProjectLifecycle` and `ProjectWorkspace` — auto-save added but shell structure unchanged
- `useSavedProjects` and `ActiveWorkspaceContext` — unchanged
- The `/wizard/[step]?project={id}` routing contract — unchanged
- `ProjectsLandingHeader` structure — only button handler changed from dialog to `router.push`

---

## Related ADRs

- ADR-0015: Editor Workspace Persistence (IDB-based project storage that creation flows write to)

## References

- Planning document: `docs/planning/routing-implementation-de-modalization-v2.md`
- Implementation branch: `feature/application-routing`
