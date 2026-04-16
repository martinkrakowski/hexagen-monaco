# ADR-0015: Editor Workspace Persistence via Session-Scoped EditorWorkspacePersistencePort

**Date:** 2026-04-15
**Status:** Accepted
**Authors:** Architecture Co-pilot, Human Architect
**Supersedes:** None

---

## Context

The web application allows users to edit generated files in the Monaco code editor.
Prior to this decision, editor state (selected file, edited file contents) was held
exclusively in React component state in `page.tsx`. This state is lost on browser
refresh, on navigating between the visual and code views, and on any component
unmount.

The codebase already has a Monaco persistence boundary (`MonacoPersistencePort`,
owned by `monaco-orchestration`) and a wizard draft persistence boundary
(`WizardPersistencePort`, owned by `wizard-orchestration`). Neither can carry
multi-file editor workspace state:

- `MonacoSession` models a single content buffer with one language. It cannot
  represent multiple open files, per-file dirty state, new (user-added) files,
  or the currently selected file.
- `LocalStoragePersistenceAdapter.saveSession` writes under `monaco-session-${session.id}`
  but `loadLatestSession(projectId)` reads under `monaco-session-${projectId}`.
  When `session.id !== projectId` this causes a silent restore failure.
- Extending `MonacoPersistencePort` to add multi-file semantics would force
  `LocalStoragePersistenceAdapter` to implement two distinct contracts and would
  couple wizard-level workspace concerns to the lower-level Monaco session concept.

A stable identifier for scoping persisted editor state is also required. Using a
hash of `wizardData` was rejected because any form mutation produces a new hash,
breaking the link to previously persisted edits and causing silent data loss on
refresh. Using `loadedProjectId` was rejected because it is `null` for any project
that has been generated but not yet saved through the wizard save flow, which is
the primary use case for refresh recovery.

---

## Decision

### 1. New port: `EditorWorkspacePersistencePort`

A dedicated outbound port is created in the `web-driver` bounded context. It owns
the contract for persisting and restoring multi-file editor workspace state.

```typescript
interface EditorWorkspacePersistencePort {
  saveWorkspace(
    sessionId: string,
    workspace: PersistedEditorWorkspace,
  ): Promise<Result<void, PersistenceError>>;

  loadWorkspace(
    sessionId: string,
  ): Promise<Result<PersistedEditorWorkspace | null, PersistenceError>>;

  clearWorkspace(sessionId: string): Promise<Result<void, PersistenceError>>;
}
```

### 2. Payload: `PersistedEditorWorkspace`

```typescript
type PersistedEditorWorkspace = {
  schemaVersion: 1;
  sessionId: string;
  updatedAt: number;
  selectedFileId: string | null;
  files: Record<
    string,
    {
      content: string;
      isNew: boolean;
      dirty: boolean;
      updatedAt: number;
    }
  >;
};
```

`schemaVersion` is mandatory. Any persisted payload with an unrecognised version
is discarded on load (not an error — treated as empty workspace).

`updatedAt` at the workspace level enables cross-tab conflict detection via the
`storage` window event.

### 3. Session-scoped identifier

A `sessionId` (`crypto.randomUUID()`) is generated when `handleGenerate`
completes successfully in `page.tsx`. It is:

- Stored alongside the wizard draft (`WizardDraft.sessionId`) so it survives
  browser refresh via the existing `useWizardDraft` persistence path.
- The sole key used to scope all editor workspace persistence operations.
- Cleared when `handleDiscardAndNew` runs, which also triggers
  `clearWorkspace(sessionId)`.

`WizardDraft` in `@hexagen/shared` gains an optional `sessionId?: string` field
to carry this value through the draft lifecycle without a breaking change to the
existing draft schema.

### 4. Adapter: `LocalStoragePersistenceAdapter`

The existing adapter in `web-driver` is extended to also implement
`EditorWorkspacePersistencePort`. Storage key: `hexagen-editor-workspace-${sessionId}`.

`QuotaExceededError` is caught explicitly in `saveWorkspace` and returned as a
`PersistenceError` with kind `StorageQuotaExceeded` rather than silently swallowed.

### 5. Lifecycle hooks

| Event                     | Action                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| `handleGenerate` succeeds | generate `sessionId`, store in draft, call `saveWorkspace` on first edit |
| Browser refresh           | restore from `loadWorkspace(sessionId)` on mount                         |
| `handleDiscardAndNew`     | call `clearWorkspace(sessionId)`, clear draft                            |
| `handleSaveAndNew`        | call `clearWorkspace(sessionId)`, clear draft                            |
| Wizard form mutation      | no effect on persisted workspace                                         |
| `handleGenerate` re-run   | generate new `sessionId`, old workspace cleared                          |

### 6. Partial restore strategy

If `loadWorkspace` returns a payload where individual file entries fail
validation, valid entries are restored and invalid entries are discarded with a
logger warning. The workspace is not wholesale rejected due to one corrupt entry.

### 7. Write strategy

Workspace writes are debounced per-file at 500ms after the last edit to that
file, then batch-flushed as a single `saveWorkspace` call. The selected file is
always included in the flush even if not dirty.

---

## Manifest changes

**`shared` bounded context:**

- `layers.domain.value_objects`: add `PersistedEditorWorkspace`

**`web-driver` bounded context:**

- `layers.domain.ports.out`: add `EditorWorkspacePersistencePort`

**`wizard-orchestration` bounded context:**

- `WizardDraft` entity: add optional `sessionId?: string` field

---

## Consequences

### Positive

- Editor file edits, additions, and selection survive browser refresh
- Lifecycle is unified with wizard draft — single sessionId scopes both
- `QuotaExceededError` is surfaced, not silently lost
- Schema versioning prevents corrupt persisted state from breaking the app
- Cross-tab write conflicts are detectable via `updatedAt`

### Negative

- `WizardDraft` gains a new optional field — existing persisted drafts without
  `sessionId` will hydrate without workspace restore (graceful degradation)
- `LocalStoragePersistenceAdapter` now implements three ports — consider splitting
  if a fourth is added

### Neutral

- `MonacoPersistencePort` key mismatch bug (`session.id` vs `projectId`) is left
  in place — it has zero production consumers and will be fixed under a separate
  ADR when `MonacoPersistencePort` is actively consumed. The new
  `EditorWorkspacePersistencePort` does not touch the broken code path at all.

---

## Verification

1. Browser refresh after editing a file restores that file's content and selection
2. Switching between visual and code view does not lose edited content
3. "New Project" clears all persisted workspace state for the previous session
4. Re-running generation clears previous edits and assigns a new sessionId
5. A corrupt workspace entry does not prevent valid entries from restoring
6. `yarn build && yarn typecheck && yarn lint` pass after implementation
7. `yarn lint:arch` reports no violations after manifest update

---

## Related

- `packages/shared/src/application/ports/editor-workspace-persistence.port.ts` (new)
- `packages/shared/src/domain/persisted-editor-workspace.ts` (new)
- `packages/shared/src/domain/wizard-draft.ts` — `WizardDraft.sessionId` field
- `packages/web-driver/src/infrastructure/adapters/local-storage-persistence.adapter.ts`
- `apps/web/app/hooks/use-editor-workspace.ts` (new)
- `apps/web/app/hooks/use-wizard-draft.ts`
- `apps/web/app/page.tsx`
- ADR-0001: Persistence Wiring
