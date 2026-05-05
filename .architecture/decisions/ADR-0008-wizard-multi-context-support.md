# ADR-0008: Wizard Multi-Context Support — Keyed Collection Pattern

**Status:** Accepted  
**Date:** 2026-03-18  
**Authors:** Architecture Co-pilot, Human Architect  
**Related PR:** TBD

---

## Context

The current project wizard (`apps/web/app/page.tsx`) supports:

- Multiple internal bounded contexts (Step 2)
- Multiple peer/external bounded contexts (Step 4)
- Single active context editing (via index-based selection)

**Problem:** The state is modeled as flat arrays without an explicit "active context" selector. Users cannot easily switch between contexts across all steps, and the UI pattern varies per step (button group on Step 3, no selector on Steps 2/4).

### Scope of Context Management per Wizard Step

| Step | Current Handles                         | Target Handles                                                         |
| ---- | --------------------------------------- | ---------------------------------------------------------------------- |
| 1    | Project type (LLM, Blockchain)          | **Comprehensive Registry** — internal bounded contexts + peer contexts |
| 2    | Workspace scope + internal BCs          | Infrastructure config for `activeContext`                              |
| 3    | Domain entities/use cases for active BC | Domain config for `activeContext`                                      |
| 4    | Peer/external contexts                  | Peer contexts for `activeContext`                                      |

---

## Decision

We adopt a **keyed-collection pattern** where:

1. **State Structure:**

   ```typescript
   interface WizardMultiContextState {
     activeContextId: string;
     contexts: BoundedContext[];
   }
   ```

2. **Step 1 Behavior:** Acts as the comprehensive registry where users add/remove both internal bounded contexts and peer contexts. This consolidates what is currently split across Steps 2 and 4.

3. **Context Selector:** A dropdown selector appears on **ALL Steps 2, 3, and 4** when `contexts.length > 1`. The selector is persistent and controls which context's data is displayed.

4. **Re-render Mechanism:** The `activeContext` is a derived value (`state.contexts.find(c => c.id === state.activeContextId)`). Each step component receives it as a prop. When `activeContextId` changes via selector, React automatically re-renders all steps with the new context data.

---

## Consequences

### Positive

- Users can define multiple bounded contexts in a single registry view (Step 1)
- Consistent context switching across all subsequent steps
- Backwards compatible: defaults to single context with no selector shown
- Single source of truth for `activeContextId` eliminates index-based bugs

### Negative

- Requires migration of peer context UI from Step 4 → Step 1
- Must update `WizardData` interface in `@hexagen/shared`
- Existing Step 2 "Add Context" button pattern changes

### Risks

- Breaking existing users who have muscle memory for Step 4 peer contexts
- Canvas visualization must handle multiple bounded contexts (already supports array)

---

## Technical Details

### Domain Layer Changes (`@hexagen/shared`)

```typescript
// New value object
export interface WizardMultiContextState {
  activeContextId: string;
  contexts: BoundedContext[];
}

// Projection function for UI
export function deriveContextSelectorViewModel(
  contexts: BoundedContext[],
  activeId: string,
): ContextSelectorViewModel {
  return {
    id: activeId,
    label: contexts.find((c) => c.id === activeId)?.name || "Unknown",
    options: contexts.map((ctx) => ({ value: ctx.id, label: ctx.name })),
  };
}

// Validation invariant
export function validateContextNames(
  contexts: BoundedContext[],
): Result<void, ValidationError> {
  const names = contexts.map((c) => c.name);
  if (new Set(names).size !== names.length) {
    return {
      success: false,
      error: new ValidationError("Duplicate context names"),
    };
  }
  return { success: true };
}
```

### UI Layer Changes (`apps/web/app/components/project-wizard/`)

| File                        | Change                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| `project-wizard.tsx`        | Refactor state to `WizardMultiContextState`, add context selector |
| `context-selector.tsx`      | NEW: Dropdown component for Steps 2+                              |
| `step-1-registry.tsx`       | Refactor to handle both internal + peer contexts                  |
| `step-2-infrastructure.tsx` | NEW: Extract infrastructure step, accept `activeContext` prop     |
| `step-3-domain.tsx`         | NEW: Extract domain step, accept `activeContext` prop             |

### Test Double Structure

```typescript
// packages/shared/__tests__/doubles/wizard-multi-context-fake.ts
export class WizardMultiContextFake implements IProjectWizardController {
  private _contexts: BoundedContext[] = [];
  private _activeId!: string;

  setContexts(contexts: BoundedContext[]): void {
    this._contexts = contexts;
  }
  setActiveId(id: string): void {
    this._activeId = id;
  }
  getContext(): BoundedContext | null {
    return this._contexts.find((c) => c.id === this._activeId) || null;
  }
}
```

---

## Migration Path

1. **Initialize:** Default to `{ activeContextId: "default", contexts: [{ id: "default", name: "Core" }] }`
2. **Step 1:** Migrate peer context UI from Step 4 → Step 1, combine with internal BC registry
3. **Step 2+:** Show selector when `contexts.length > 1`, hide when single context (backwards compatible)
4. **Persist:** Use same `WizardData` serialization — canvas already reads `boundedContexts[]`

---

## References

- `.architecture/manifest.yaml` — bounded contexts definition
- `packages/shared/src/domain/wizard-data.ts` — current WizardData interface
- `apps/web/app/page.tsx` — current wizard implementation
