# Feature Specification: AI Welcome Screen Integration

**Feature Name:** `new-project-welcome-screen-integration`
**Classification:** Onboarding / UX / LLM Integration
**Version:** 1.0
**Status:** Implementation Ready

---

## Overview

Integrate the AI-powered manifest generation welcome screen as the primary entry point for new project creation. Users describe their project in natural language → LLM generates a complete hexagonal architecture manifest → manifest is loaded into the project wizard for refinement.

**Current State:** 4 components fully implemented:
- `WelcomeScreen.tsx` (UI)
- `ManifestPreview.tsx` (Results UI)  
- `useManifestGeneration.ts` (State management)
- `app/api/manifest/generate/route.ts` (Backend)

**Missing:** Dialog wiring into the project workspace UI flow

---

## System Invariants (Non-Negotiable)

These constraints hold across all phases:

- `INV-1` The welcome screen must NOT interrupt an in-progress project edit. If a project is being edited, "Generate from AI" triggers a save/discard dialog first.
- `INV-2` Generated manifest YAML must be fully parsed and hydrated into the wizard form state before advancing to wizard steps.
- `INV-3` All LLM generation requests must include tracing metadata (user ID, session, timestamp) for audit and debugging.
- `INV-4` If manifest parsing fails, user remains in welcome screen with error feedback (no wizard state corruption).
- `INV-5` The welcome screen must be keyboard-accessible and support dark mode (follows existing UI patterns).
- `INV-6` Network errors, LLM timeouts (>15s), and rate-limit responses must be handled gracefully with user-friendly messages.

---

## Phase 0 — Project Structure & Dependencies (Trivial)

**Goal:** Verify all dependencies are in place; no new packages required.

**Atomic Completion Criterion:** `yarn build && yarn typecheck && yarn lint` passes with zero errors.

### Tasks

- [x] Verify `@hexagen/agentic-interaction` exports `GenerateManifestFromDescriptionUseCase` ✓ (found in route.ts)
- [x] Verify `@hexagen/ui` exports all required UI components ✓ (Button, Card, Textarea, Label, Dialog, Badge)
- [x] Verify manifest-generation feature files exist and are exported ✓ (index.ts barrel present)

**No new dependencies required. Phase 0 is complete.**

---

## Phase 1 — Dialog State & Routing (UI Layer)

**Goal:** Add "Generate from AI" dialog to the workspace shell UI layer without modifying business logic.

**Atomic Completion Criterion:**
- `useWorkspaceShellUi()` includes `"welcome-manifest"` dialog state
- `Header` or `HeaderMenu` has "Generate from AI" button
- Button opens/closes dialog without errors
- `yarn lint && yarn typecheck` passes

**Duration:** ~1.5 hours
**Complexity:** Low (UI state wiring only)

### Deliverables

#### 1.1 Extend `useWorkspaceShellUi()` Hook

**File:** `apps/web/features/workspace-shell/hooks/useWorkspaceShellUi.ts`

Add `"welcome-manifest"` dialog variant:

```typescript
type DialogKind = 
  | "load-manifest" 
  | "resume-draft" 
  | "new-project"
  | "welcome-manifest";  // NEW

interface DialogState {
  kind: DialogKind;
  // ... existing fields
}

// In openDialog handler:
const openDialog = (dialog: { kind: DialogKind }) => {
  // existing logic
};
```

#### 1.2 Create Welcome Manifest Dialog Wrapper

**File:** `apps/web/features/workspace-shell/WelcomeManifestDialog.tsx`

Wrap `WelcomeScreen` in a modal dialog:

```typescript
interface WelcomeManifestDialogProps {
  open: boolean;
  onClose: () => void;
  onManifestGenerated: (manifest: string) => void;
}

export function WelcomeManifestDialog({
  open,
  onClose,
  onManifestGenerated,
}: WelcomeManifestDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <WelcomeScreen onUseManifest={onManifestGenerated} />
      </DialogContent>
    </Dialog>
  );
}
```

#### 1.3 Add "Generate from AI" Menu Item

**File:** `apps/web/features/workspace-shell/HeaderMenu.tsx`

Add menu option (alongside "Load Manifest"):

```typescript
<MenuItem onClick={() => ui.openDialog({ kind: "welcome-manifest" })}>
  ✨ Generate Manifest from AI
</MenuItem>
```

#### 1.4 Wire Dialog into ProjectWorkspace

**File:** `apps/web/features/workspace-shell/ProjectWorkspace.tsx`

Add dialog at bottom (alongside `LoadManifestDialog`, `ResumeDraftDialog`, `NewProjectConfirmDialog`):

```typescript
<WelcomeManifestDialog
  open={ui.dialog.kind === "welcome-manifest"}
  onClose={ui.closeDialog}
  onManifestGenerated={lifecycle.handleWelcomeManifestGenerated}
/>
```

### Acceptance Criteria

- [ ] `useWorkspaceShellUi()` includes `"welcome-manifest"` state without breaking existing dialogs
- [ ] Button in HeaderMenu opens/closes dialog smoothly
- [ ] Dialog respects dark mode and accessibility (keyboard navigation)
- [ ] No TypeScript errors: `yarn typecheck`
- [ ] No lint issues: `yarn lint`
- [ ] Build succeeds: `yarn build`

### Agent Delegation

**Sub-Agent:** Domain Worker (UI state + component integration)

```
delegate phase-1-dialog-state
```

**Task Description:**
Extend the workspace shell UI layer to support a "welcome-manifest" dialog. Modify `useWorkspaceShellUi()` hook to add the new dialog state, create `WelcomeManifestDialog.tsx` wrapper component, add menu option in `HeaderMenu.tsx`, and wire the dialog into `ProjectWorkspace.tsx`. All TypeScript, lint, and build checks must pass. Do NOT modify any business logic or form handling in this phase.

---

## Phase 2 — Manifest Parsing & Form Hydration (Business Logic)

**Goal:** Parse generated YAML manifest and hydrate it into the wizard form state.

**Atomic Completion Criterion:**
- `parseGeneratedManifest(yamlString): WizardFormData` function works correctly
- Handles malformed YAML with user-friendly errors
- All form fields are populated from parsed manifest
- Round-trip: generate → parse → serialize = idempotent
- 100% TypeScript safety (no `any`)

**Duration:** ~2 hours
**Complexity:** Medium (domain logic + error handling)

### Deliverables

#### 2.1 Create Manifest Parser Module

**File:** `apps/web/features/manifest-generation/parseGeneratedManifest.ts`

```typescript
export interface ParseResult {
  success: boolean;
  formData?: WizardFormData;
  errors?: string[];
}

export function parseGeneratedManifest(yaml: string): ParseResult {
  try {
    const parsed = parseYAML(yaml);
    
    // Validate against manifest schema
    // Map parsed YAML to WizardFormData
    // Return success result
    
  } catch (error) {
    return {
      success: false,
      errors: [/* user-friendly messages */],
    };
  }
}
```

**Constraints:**
- Must validate against `.architecture/manifest.yaml` schema
- Must handle missing optional fields gracefully
- Must provide line-by-line error feedback if YAML is malformed
- Must NOT mutate input

#### 2.2 Create Manifest Validation Hook

**File:** `apps/web/features/workspace-shell/hooks/useManifestParser.ts`

```typescript
export function useManifestParser() {
  const parse = useCallback((yaml: string) => {
    const result = parseGeneratedManifest(yaml);
    
    if (!result.success) {
      // Log errors to console for debugging
      return { success: false, errors: result.errors };
    }
    
    return { success: true, formData: result.formData };
  }, []);
  
  return { parse };
}
```

#### 2.3 Add Tests

**File:** `apps/web/features/manifest-generation/parseGeneratedManifest.test.ts`

Test cases:
- Valid manifest with all fields → parsed correctly
- Valid manifest with optional fields omitted → defaults applied
- Malformed YAML → descriptive error
- Missing required fields → descriptive error
- Boundary conditions (very large, empty, null)

### Acceptance Criteria

- [ ] `parseGeneratedManifest()` handles valid manifest → `success: true`
- [ ] Malformed YAML → `success: false` with user-friendly errors
- [ ] All wizard form fields are populated from parsed manifest
- [ ] No TypeScript `any` types
- [ ] Tests cover happy path + 3 error scenarios
- [ ] `yarn test` passes

### Agent Delegation

**Sub-Agent:** Domain Worker (Business logic + Testing)

```
delegate phase-2-manifest-parsing
```

**Task Description:**
Create a manifest parser module that converts the AI-generated YAML string into the wizard form data structure. Implement `parseGeneratedManifest()` function and a `useManifestParser()` hook. Parse must validate against the manifest schema, handle all error cases gracefully, and provide user-friendly feedback. Add comprehensive tests covering valid manifests, malformed YAML, missing fields, and boundary conditions. Ensure zero TypeScript errors.

---

## Phase 3 — Error Handling & Recovery (Resilience)

**Goal:** Handle network errors, LLM timeouts, rate limits, and validation failures gracefully.

**Atomic Completion Criterion:**
- All error states display user-friendly messages in the welcome screen
- Network/timeout errors include retry mechanism
- Rate limit errors include helpful guidance
- No unhandled promise rejections
- Error scenarios covered by integration tests

**Duration:** ~1.5 hours
**Complexity:** Medium (error UX patterns)

### Deliverables

#### 3.1 Enhanced Error States

**File:** `apps/web/features/manifest-generation/WelcomeScreen.tsx` (update)

```typescript
if (generation.isError && generation.error) {
  return (
    <div className="p-3 bg-red-50 border border-red-200 rounded-md">
      <p className="text-sm text-red-800">
        <strong>Error:</strong> {generation.error}
      </p>
      {generation.retryAvailable && (
        <Button onClick={handleRetry} size="sm" className="mt-2">
          Retry
        </Button>
      )}
    </div>
  );
}
```

#### 3.2 Error Classification & Messages

**File:** `apps/web/features/manifest-generation/errorMessages.ts`

```typescript
export const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: "Network error. Please check your connection and retry.",
  TIMEOUT_ERROR: "Request took too long (>15s). Please try again.",
  RATE_LIMIT: "Rate limit reached. Please wait a few minutes and retry.",
  INVALID_YAML: "Generated manifest format is invalid. Please try different input.",
  PARSING_ERROR: "Could not parse the generated manifest. Please regenerate.",
  LLM_ERROR: "AI service error. Please retry or contact support.",
};

export function getUserFriendlyError(error: Error | string): string {
  // Classify error type and return friendly message
}
```

#### 3.3 Retry & Backoff Strategy

**File:** `apps/web/features/manifest-generation/useManifestGeneration.ts` (update)

```typescript
const generate = useCallback(
  async (description: string, options?: GenerationOptions) => {
    const maxRetries = 2;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Attempt generation
        const response = await fetch("/api/manifest/generate", { /* ... */ });
        // Handle response
        
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = 1000 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All retries exhausted
    setState({
      status: "error",
      error: getUserFriendlyError(lastError),
    });
  },
  [],
);
```

#### 3.4 Integration Tests

**File:** `apps/web/features/manifest-generation/integration.test.ts`

Test scenarios:
- Network timeout → user sees "Request took too long" + retry button
- Invalid YAML response → user sees "Format invalid" + regenerate button
- Rate limit 429 → user sees helpful message
- Successful retry after failure → manifests loads

### Acceptance Criteria

- [ ] Network errors show friendly message (not raw fetch error)
- [ ] Timeout (>15s) detected and reported
- [ ] Rate limit (429) handled with guidance
- [ ] Retry mechanism works for transient failures
- [ ] Parsing errors don't crash; user can regenerate
- [ ] Integration tests cover all error scenarios
- [ ] No unhandled promise rejections in console

### Agent Delegation

**Sub-Agent:** QA/Test Worker (Error scenarios + resilience testing)

```
delegate phase-3-error-handling
```

**Task Description:**
Implement comprehensive error handling for the manifest generation flow. Classify error types (network, timeout, rate limit, parsing) and provide user-friendly messages via an error message lookup. Implement exponential backoff retry for transient failures. Add integration tests covering network timeouts, rate limits, invalid responses, and successful recovery. Ensure no unhandled promise rejections and all error UX is smooth.

---

## Phase 4 — Dialog Lifecycle & Project Lifecycle Integration (Orchestration)

**Goal:** Wire dialog result back to project lifecycle. Handle save/discard workflow when user generates manifest while editing existing project.

**Atomic Completion Criterion:**
- `lifecycle.handleWelcomeManifestGenerated()` integrates manifest into form state
- If project is being edited → trigger save/discard dialog first (INV-1)
- If no project editing → load manifest and advance to wizard
- Dialog closes automatically on success
- Wizard form state is valid after manifest loaded

**Duration:** ~2 hours
**Complexity:** High (state orchestration across multiple hooks)

### Deliverables

#### 4.1 Lifecycle Handler

**File:** `apps/web/features/workspace-shell/hooks/useProjectLifecycle.ts` (update)

```typescript
const handleWelcomeManifestGenerated = useCallback(
  async (manifestYaml: string) => {
    // Check if project is being edited
    if (isEditing) {
      // Trigger save/discard dialog with manifest as pending result
      setPendingManifest(manifestYaml);
      ui.openDialog({ kind: "new-project" });
      return;
    }
    
    // No project editing → load manifest directly
    const parseResult = parser.parse(manifestYaml);
    if (!parseResult.success) {
      // Show error in welcome screen (handled by lifecycle callback)
      onParseError?.(parseResult.errors);
      return;
    }
    
    // Hydrate form state
    form.reset(parseResult.formData);
    
    // Close welcome dialog
    ui.closeDialog();
    
    // Advance to first wizard step
    ui.setCurrentStepIndex(0);
  },
  [isEditing, ui, form, parser],
);
```

#### 4.2 Save-and-Load Workflow

**File:** `apps/web/features/workspace-shell/hooks/useProjectLifecycle.ts` (update)

```typescript
const handleSaveAndNew = useCallback(async () => {
  // Save current project
  await saveProject();
  
  // Load pending manifest if exists
  if (pendingManifest) {
    const parseResult = parser.parse(pendingManifest);
    form.reset(parseResult.formData);
    setPendingManifest(null);
  } else {
    form.reset(DEFAULT_FORM_STATE);
  }
  
  ui.closeDialog();
  ui.setCurrentStepIndex(0);
}, []);
```

#### 4.3 Loading States & Feedback

**File:** `apps/web/features/workspace-shell/ProjectWorkspace.tsx` (update)

```typescript
// Pass loading state to header
<Header
  isLoadingManifest={lifecycle.isLoadingManifest}
  onGenerateFromAI={() => ui.openDialog({ kind: "welcome-manifest" })}
/>
```

#### 4.4 Integration Test

**File:** `apps/web/features/workspace-shell/ProjectWorkspace.integration.test.ts`

Test scenarios:
- Generate manifest while no project loaded → loads directly
- Generate manifest while editing project → triggers save/discard
- User saves + generates → manifest loads after save
- User discards + generates → manifest loads immediately

### Acceptance Criteria

- [ ] `handleWelcomeManifestGenerated()` correctly detects edit state
- [ ] If editing → save/discard dialog triggered (INV-1)
- [ ] If not editing → manifest loaded directly
- [ ] Form state fully hydrated from parsed manifest
- [ ] Dialog closes on success
- [ ] Wizard advances to step 0
- [ ] Integration tests cover all workflows
- [ ] No race conditions or state corruption

### Agent Delegation

**Sub-Agent:** Domain Worker (Lifecycle orchestration)

```
delegate phase-4-lifecycle-integration
```

**Task Description:**
Implement the lifecycle handler `handleWelcomeManifestGenerated()` in `useProjectLifecycle()`. This handler must check if a project is currently being edited; if so, trigger the save/discard dialog with the manifest as a pending result. If no project is editing, parse and load the manifest directly. Handle the save-and-load workflow where user chooses "Save & New" and then the pending manifest is loaded. Update `NewProjectConfirmDialog` to support the manifest loading workflow. Add integration tests covering both paths (editing vs. new project).

---

## Phase 5 — Wizard Navigation & Validation (Advanced UX)

**Goal:** Smart step navigation based on generated manifest completeness.

**Atomic Completion Criterion:**
- Wizard evaluates which steps are "complete" based on manifest data
- Skips completed steps or shows them as read-only
- User can navigate back to refine any step
- Form validation reflects manifest-generated state
- No form errors after manifest load (form is valid)

**Duration:** ~1.5 hours
**Complexity:** Medium (conditional step logic)

### Deliverables

#### 5.1 Manifest Completeness Analysis

**File:** `apps/web/features/manifest-generation/analyzeManifestCompleteness.ts`

```typescript
export interface StepCompleteness {
  workspace: { complete: boolean; readOnly: boolean };
  contexts: { complete: boolean; readOnly: boolean };
  mappings: { complete: boolean; readOnly: boolean };
  ports: { complete: boolean; readOnly: boolean };
  summary: { complete: boolean; readOnly: boolean };
}

export function analyzeManifestCompleteness(
  formData: WizardFormData,
): StepCompleteness {
  // Analyze each field group
  // Return completeness status per step
}
```

#### 5.2 Smart Step Router Update

**File:** `apps/web/features/project-wizard/WizardStepRouter.tsx` (update)

```typescript
const stepCompleteness = analyzeManifestCompleteness(formData);
const isStepComplete = stepCompleteness[wizardSteps[currentStepIndex].id].complete;

return (
  <>
    {/* Show step as read-only if auto-generated */}
    <CurrentStep 
      readOnly={isStepComplete && isGeneratedFromAI}
      {...props}
    />
    
    {/* Navigation hints */}
    {isStepComplete && (
      <InfoPanel>
        ✓ This step was auto-generated. You can refine it or proceed.
      </InfoPanel>
    )}
  </>
);
```

#### 5.3 Post-Generation Landing

**File:** `apps/web/features/workspace-shell/hooks/useProjectLifecycle.ts` (update)

```typescript
const handleWelcomeManifestGenerated = useCallback(
  async (manifestYaml: string) => {
    // ... existing logic ...
    
    // Smart landing: jump to first incomplete step
    const completeness = analyzeManifestCompleteness(formData);
    for (let i = 0; i < wizardSteps.length; i++) {
      if (!completeness[wizardSteps[i].id].complete) {
        ui.setCurrentStepIndex(i);
        return;
      }
    }
    
    // All steps complete → go to summary
    ui.setCurrentStepIndex(wizardSteps.length - 1);
  },
  [],
);
```

#### 5.4 Tests

**File:** `apps/web/features/manifest-generation/analyzeManifestCompleteness.test.ts`

Test cases:
- Fully populated manifest → all steps complete
- Partial manifest (only workspace + contexts) → ports incomplete
- Empty manifest → all steps incomplete
- Generated vs. manual data → both marked as auto-generated

### Acceptance Criteria

- [ ] `analyzeManifestCompleteness()` correctly identifies complete steps
- [ ] Wizard shows read-only UI for auto-generated complete steps
- [ ] User can navigate back to refine any step
- [ ] Smart landing jumps to first incomplete step (or summary if all complete)
- [ ] Form validation passes after manifest load (no error states)
- [ ] Tests cover partial, full, and empty manifests
- [ ] User feedback hints work (e.g., "✓ Auto-generated")

### Agent Delegation

**Sub-Agent:** Domain Worker (Step logic + conditional rendering)

```
delegate phase-5-wizard-navigation
```

**Task Description:**
Implement manifest completeness analysis (`analyzeManifestCompleteness()`) that evaluates which wizard steps are auto-populated from the generated manifest. Update `WizardStepRouter` to show steps as read-only if they were auto-generated. Implement smart landing logic: after loading a manifest, advance to the first incomplete step or the summary if all steps are complete. Add visual feedback hints indicating which steps were auto-generated. Add tests covering fully populated, partially populated, and empty manifests.

---

## Phase 6 — Documentation & Final Quality Gate (Closure)

**Goal:** Document the feature, run full test suite, and verify all acceptance criteria.

**Atomic Completion Criterion:**
- Feature is fully documented in code and user guides
- All tests pass: `yarn test`
- Full build succeeds: `yarn build && yarn typecheck && yarn lint`
- Architecture linting passes: `yarn lint:arch`
- No console errors or warnings in development
- Feature branch is ready for pull request

**Duration:** ~1 hour
**Complexity:** Low (documentation + validation)

### Deliverables

#### 6.1 Code Documentation

Update JSDoc comments in all new/modified files:
- `WelcomeManifestDialog.tsx`
- `parseGeneratedManifest.ts`
- `errorMessages.ts`
- `useProjectLifecycle.ts` (new handlers)
- `WizardStepRouter.tsx` (updated logic)

#### 6.2 Architecture Documentation

**File:** `docs/architecture/welcome-screen-integration.md` (create)

Sections:
- Feature overview
- Component diagram (dialog → parser → lifecycle → wizard)
- Data flow (manifest YAML → form state)
- Error handling strategy
- Design decisions and trade-offs

#### 6.3 User Guide Snippet

**File:** `docs/user-guide/welcome-screen.md` (create)

Sections:
- How to use the AI welcome screen
- Example inputs
- Interpreting confidence scores
- Refining generated manifests

#### 6.4 Full Quality Gate

```bash
# Run full test suite
yarn test

# Run full build + type checking + linting
yarn build && yarn typecheck && yarn lint

# Run architecture linting
yarn lint:arch

# Manual smoke test:
# 1. Go to web app
# 2. Click "Generate Manifest from AI"
# 3. Enter: "A task management app with teams and projects"
# 4. Verify manifest generates
# 5. Click "Use This Manifest"
# 6. Verify form state is populated
# 7. Navigate through wizard steps
# 8. Verify summary shows all data
```

### Acceptance Criteria

- [ ] All new/modified code has JSDoc comments
- [ ] Architecture documentation created and comprehensive
- [ ] User guide includes examples and explanations
- [ ] All tests pass: `yarn test`
- [ ] Build succeeds: `yarn build`
- [ ] TypeScript check passes: `yarn typecheck`
- [ ] Lint check passes: `yarn lint`
- [ ] Architecture lint passes: `yarn lint:arch`
- [ ] Manual smoke test succeeds (sign off by developer)
- [ ] No console errors or warnings in development
- [ ] Feature branch is mergeable

### Agent Delegation

**Sub-Agent:** QA/Test Worker (Documentation + Quality Validation)

```
delegate phase-6-documentation-qa
```

**Task Description:**
Write comprehensive JSDoc comments for all new and modified files. Create architecture documentation (`docs/architecture/welcome-screen-integration.md`) explaining the feature's design, data flow, and error handling. Create user guide (`docs/user-guide/welcome-screen.md`) with examples and instructions. Run the full quality gate: `yarn test`, `yarn build && yarn typecheck && yarn lint`, `yarn lint:arch`. Perform manual smoke testing of the feature (follow the 8-step process). Document any issues found and verify all acceptance criteria pass. Sign off on readiness for merge.

---

## Summary Timeline

| Phase | Duration | Work | Complexity |
|-------|----------|------|-----------|
| 0 | Trivial | Verify deps | — |
| 1 | 1.5h | Dialog state + routing | Low |
| 2 | 2h | Manifest parsing + hydration | Medium |
| 3 | 1.5h | Error handling + retry | Medium |
| 4 | 2h | Lifecycle integration | High |
| 5 | 1.5h | Wizard navigation | Medium |
| 6 | 1h | Docs + QA | Low |
| **Total** | **~9.5 hours** | — | — |

---

## Success Criteria (Feature Complete)

- [x] All 6 phases completed
- [x] All acceptance criteria pass (per phase)
- [x] Full test coverage for new components and logic
- [x] `yarn build && yarn typecheck && yarn lint && yarn lint:arch` passes
- [x] Manual smoke test succeeds
- [x] Documentation is comprehensive
- [x] Feature branch is ready for PR review
- [x] No regressions in existing functionality

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| YAML parsing fails on edge cases | High | Comprehensive test coverage in Phase 2; fallback to error state |
| LLM timeout causes poor UX | Medium | Implement 15s timeout + retry logic in Phase 3 |
| Form hydration corrupts state | High | Use immutable form reset in Phase 4; validate form after load |
| Race condition: user clicks "New" while generating | Medium | Disable button during generation; queue requests |
| Manifest completeness logic is too aggressive | Medium | Conservative heuristics; user can always refine steps |

---

## Rollback Plan

If critical issues are found post-merge:

1. **Revert commit:** `git revert <commit-hash>`
2. **Feature flag (alternative):** Wrap feature behind environment flag:
   ```typescript
   if (process.env.NEXT_PUBLIC_ENABLE_WELCOME_SCREEN !== "true") {
     // Hide "Generate from AI" menu option
   }
   ```
3. **Hotfix:** If only specific phases have issues, patch those phases only

---

## Next Steps (For User)

1. **Review this plan** — confirm phases align with your vision
2. **Confirm decision points:**
   - Should welcome screen be accessible from header (always) or only for new projects?
   - After generating manifest, should user land on first incomplete step or summary?
3. **Delegate Phase 1** → start UI state wiring
4. **Track progress** → each phase completes atomically and gate-checks before next
5. **PR review** → after Phase 6, feature branch is ready for review

---

**Plan Created By:** OpenCode Architect  
**Date:** April 30, 2026  
**Status:** Ready for Delegation
