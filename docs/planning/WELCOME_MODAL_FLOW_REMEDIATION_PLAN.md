# HexaGen Monaco — Welcome Modal LLM Integration

## Atomically Phased Declarative Development Plan

> **Governing Constraints**
>
> - Hexagonal/DDD architecture must be maintained (`yarn lint:arch` must pass)
> - All gates must pass: `yarn build && yarn typecheck && yarn lint && yarn lint:arch`
> - No `any` types (`@typescript-eslint/no-explicit-any: error`)
> - Tests use `node:test` + `node:assert` exclusively
> - Each phase is independently verifiable before the next begins
> - No phase modifies files outside its declared scope

---

## Table of Contents

1. [Phase 0 — Pre-Flight Audit](#phase-0--pre-flight-audit)
2. [Phase 1 — Extract Shared YAML Utility](#phase-1--extract-shared-yaml-utility)
3. [Phase 2 — Export Prompts from Public API](#phase-2--export-prompts-from-public-api)
4. [Phase 3 — Expand LocalLLMContext Interface](#phase-3--expand-localllmcontext-interface)
5. [Phase 4 — Client-Side Manifest Generation Hook](#phase-4--client-side-manifest-generation-hook)
6. [Phase 5 — State Machine Hardening](#phase-5--state-machine-hardening)
7. [Phase 6 — Replace SimpleModelSelection with ModelSettingsView](#phase-6--replace-simplemodelsection-with-modelsettingsview)
8. [Phase 7 — Fix Local Inference Routing in WelcomeScreen](#phase-7--fix-local-inference-routing-in-welcomescreen)
9. [Phase 8 — Dialog Shell Improvements](#phase-8--dialog-shell-improvements)
10. [Phase 9 — Auto-Transition After Model Load](#phase-9--auto-transition-after-model-load)
11. [Phase 10 — Preference Persistence & Remember Choice](#phase-10--preference-persistence--remember-choice)
12. [Phase 11 — Error Taxonomy & Recovery Paths](#phase-11--error-taxonomy--recovery-paths)
13. [Phase 12 — Governance Panel Integration](#phase-12--governance-panel-integration)
14. [Phase 13 — Model Cache Integrity (v1 Smoke Test)](#phase-13--model-cache-integrity-v1-smoke-test)
15. [Phase 14 — Final Integration Verification](#phase-14--final-integration-verification)
16. [Appendix A — State Machine Reference](#appendix-a--state-machine-reference)
17. [Appendix B — Component Tree Reference](#appendix-b--component-tree-reference)
18. [Appendix C — Architectural Decision Log](#appendix-c--architectural-decision-log)

---

## Phase 0 — Pre-Flight Audit

**Goal:** Establish a verified baseline. No code changes. Understand exact current state of all files in scope before any modification.

**Rationale:** Every subsequent phase declares preconditions based on what this audit confirms. Skipping this creates false assumptions that compound into hard-to-debug failures.

### Actions

- [ ] Read `apps/web/features/manifest-generation/WelcomeScreen.tsx` in full
  - Document: current state machine (if any), current model selection component in use, current generate trigger logic, current error handling
- [ ] Read `apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts` in full
  - Document: all 9 states, all defined transitions, what is currently exposed on the return value
- [ ] Read `apps/web/features/governance-assistant/ModelSettingsView.tsx` in full
  - Document: exact props interface, all required vs optional props, internal dependencies
- [ ] Read all sub-components in `apps/web/features/governance-assistant/model-settings/`
  - Files: `ModelSettingsHeader`, `WarningBanner`, `ModelTierSection`, `CloudModelsSection`, `StorageFooter`
  - Document: which sub-components ModelSettingsView renders and under what conditions
- [ ] Read `apps/web/features/manifest-generation/ModelSelectionFlow/SimpleModelSelection.tsx`
  - Document: current props, what it renders, what actions it calls
- [ ] Read `packages/local-llm/src/domain/ports/local-llm-context.type.ts`
  - Document: exact interface exported, all fields and their types
- [ ] Read `apps/web/lib/llm-interfaces.ts`
  - Document: what is currently re-exported, from which packages
- [ ] Read `apps/web/app/api/manifest/generate/route.ts`
  - Document: where the cloud-key check occurs, what adapter is instantiated, what the error message text is
- [ ] Read `apps/web/app/api/manifest/generate/local/route.ts`
  - Document: where WebLLMAdapter is instantiated, why it is always null server-side
- [ ] Read `packages/agentic-interaction/src/application/use-cases/generate-manifest-from-description.use-case.ts`
  - Document: `extractYamlFromResponse` method signature and logic, `generateSuggestions`, `detectWarnings`
- [ ] Read `packages/agentic-interaction/src/domain/prompts/generate-manifest.prompt.ts`
  - Document: exported names (`SYSTEM_PROMPT`, `compilePrompt`, `compileUserPrompt`, `PromptVariables`)
- [ ] Read `packages/agentic-interaction/src/index.ts`
  - Document: what is currently exported from the package's public API
- [ ] Read `apps/web/features/workspace-shell/WelcomeManifestDialog.tsx`
  - Document: current Dialog usage, props passed to WelcomeScreen, how onClose is threaded
- [ ] Read `apps/web/features/workspace-shell/ProjectWorkspace.tsx`
  - Document: how `llmContext` (from `useLocalLLM()`) is passed down to the dialog
- [ ] Read `packages/ui/src/sections/Dialog.tsx`
  - Document: current backdrop class string, where blur would be added
- [ ] Read `apps/web/features/manifest-generation/ModelSelectionFlow/modelPreferencesStorage.ts`
  - Document: localStorage key names, read/write interface, what is currently persisted
- [ ] Run `yarn build && yarn typecheck && yarn lint && yarn lint:arch` and record the current pass/fail state

### Exit Criteria

- All files listed above have been read and their current state is documented in working notes
- Baseline verification gate result is recorded
- No files have been modified

---

## Phase 1 — Extract Shared YAML Utility

**Goal:** Move `extractYamlFromResponse`, `generateSuggestions`, and `detectWarnings` from `GenerateManifestFromDescriptionUseCase` into a standalone, importable domain utility so both server-side and client-side generation paths use identical extraction logic.

**Preconditions (from Phase 0 audit):**

- `extractYamlFromResponse` exists as a private method on the use case class
- `generateSuggestions` and `detectWarnings` exist as private methods on the use case class
- `packages/agentic-interaction/src/index.ts` is the package's public export boundary

### Files Modified

| File                                                                                                    | Operation  | Notes                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `packages/agentic-interaction/src/domain/value-objects/manifest-yaml-extractor.ts`                      | **CREATE** | New standalone utility                                                                |
| `packages/agentic-interaction/src/application/use-cases/generate-manifest-from-description.use-case.ts` | **MODIFY** | Import from new utility, remove private method duplicates                             |
| `packages/agentic-interaction/src/index.ts`                                                             | **MODIFY** | Export `extractManifestYaml`, `generateManifestSuggestions`, `detectManifestWarnings` |

### Declarations

**`manifest-yaml-extractor.ts` must:**

- Export `extractManifestYaml(response: string): string | null` — pure function, no side effects
- Export `generateManifestSuggestions(yaml: string): string[]` — pure function
- Export `detectManifestWarnings(yaml: string): string[]` — pure function
- Contain zero imports from application or infrastructure layers (domain-only)
- Have zero `any` types

**`generate-manifest-from-description.use-case.ts` must:**

- Import the three functions above from the new utility module
- Remove the private method implementations that are now extracted
- Produce identical runtime behavior to the pre-change implementation
- Pass all existing tests without modification to those tests

**`index.ts` must:**

- Re-export all three utility functions at the package root
- Not break any existing exports

### Tests

- [ ] Add `packages/agentic-interaction/src/domain/value-objects/__tests__/manifest-yaml-extractor.test.ts`
  - Test `extractManifestYaml` with: valid YAML block, no YAML block, malformed YAML, empty string
  - Test `generateManifestSuggestions` with: valid manifest, empty manifest
  - Test `detectManifestWarnings` with: manifest with missing fields, complete manifest
  - Use `node:test` and `node:assert`

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

All tests in the new test file must pass.

---

## Phase 2 — Export Prompts from Public API

**Goal:** Confirm and, if necessary, add `SYSTEM_PROMPT`, `compileUserPrompt`, and `PromptVariables` to the `@hexagen/agentic-interaction` package's public API so the client-side hook (Phase 4) can import them without bypassing package boundaries.

**Preconditions (from Phase 0 audit):**

- `generate-manifest.prompt.ts` exports `SYSTEM_PROMPT` and `compileUserPrompt`
- Current state of `index.ts` exports is known

### Files Modified

| File                                        | Operation              | Notes                                     |
| ------------------------------------------- | ---------------------- | ----------------------------------------- |
| `packages/agentic-interaction/src/index.ts` | **MODIFY (if needed)** | Add prompt exports if not already present |

### Declarations

**`index.ts` must:**

- Export `SYSTEM_PROMPT: string`
- Export `compileUserPrompt: (vars: PromptVariables) => string`
- Export `PromptVariables` type
- If all three are already exported: this phase is a no-op (document and proceed)

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

---

## Phase 3 — Expand LocalLLMContext Interface

**Goal:** Ensure `WelcomeScreen` can access the full set of methods it needs from the LLM context — specifically `switchModel`, `deleteCachedModel`, `loadedModel`, `sendGovernanceMessage`, and `messages` — without accessing them through untyped workarounds.

**Preconditions (from Phase 0 audit):**

- `LocalLLMContext` type in `@hexagen/local-llm` currently exposes only: `engineState`, `initializeModel`, `cancelDownload`, `hasAnyCachedModel`, `hasModelInCache`
- `useLocalLLM()` hook returns `LocalLLMContextValue` which includes the full set of methods
- `apps/web/lib/llm-interfaces.ts` currently re-exports the narrower type

### Decision Point

Two valid approaches — select one before modifying any file:

**Option A (Preferred):** Expand `LocalLLMContext` in `@hexagen/local-llm` to include the full interface. One source of truth.

**Option B:** Change `apps/web/lib/llm-interfaces.ts` to re-export `LocalLLMContextValue` from `useLocalLlm.tsx` instead of the narrower `LocalLLMContext` from the package.

> **Recommended:** Option A, because it keeps the canonical type in the package and prevents future consumers from also needing workarounds.

### Files Modified (Option A)

| File                                                            | Operation  | Notes                                         |
| --------------------------------------------------------------- | ---------- | --------------------------------------------- |
| `packages/local-llm/src/domain/ports/local-llm-context.type.ts` | **MODIFY** | Expand interface to include full method set   |
| `apps/web/lib/llm-interfaces.ts`                                | **VERIFY** | Confirm re-export still valid after expansion |

### Declarations

**`local-llm-context.type.ts` must:**

- Add to `LocalLLMContext`:
  - `switchModel(modelId: string): Promise<void>`
  - `deleteCachedModel(modelId: string): Promise<void>`
  - `loadedModel: ModelMetadata | null`
  - `sendGovernanceMessage(prompt: string, systemPrompt: string): AsyncIterable<string>`
  - `messages: ChatMessage[]`
- All added fields must be typed with no `any`
- `ModelMetadata` and `ChatMessage` types must be importable from appropriate domain layer files — do not inline define them
- Existing consumers of the narrower interface must not break (check `ProjectWorkspace.tsx` and any other consumers identified in Phase 0)

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Confirm `ProjectWorkspace.tsx` still compiles without changes.

---

## Phase 4 — Client-Side Manifest Generation Hook

**Goal:** Create `useClientManifestGeneration.ts` — a hook that runs manifest generation entirely client-side using `sendGovernanceMessage` from the local LLM context, using the same prompts and YAML extraction as the server-side use case.

**Preconditions:**

- Phase 1 complete: `extractManifestYaml` is importable from `@hexagen/agentic-interaction`
- Phase 2 complete: `SYSTEM_PROMPT` and `compileUserPrompt` are importable from `@hexagen/agentic-interaction`
- Phase 3 complete: `sendGovernanceMessage` is typed and available on `LocalLLMContext`

### Files Modified

| File                                                                   | Operation  | Notes    |
| ---------------------------------------------------------------------- | ---------- | -------- |
| `apps/web/features/manifest-generation/useClientManifestGeneration.ts` | **CREATE** | New hook |

### Declarations

**`useClientManifestGeneration.ts` must:**

- Accept `llmContext: LocalLLMContext` as its sole parameter
- Return:
  ```typescript
  {
    generateManifest: (description: string) => Promise<void>;
    isGenerating: boolean;
    generationError: string | null;
    generatedManifest: string | null;
    reset: () => void;
  }
  ```
- Internally:
  1. Call `compileUserPrompt({ description })` to build the user message
  2. Call `llmContext.sendGovernanceMessage(userPrompt, SYSTEM_PROMPT)` to get an async iterable stream
  3. Collect all streamed chunks into a single accumulated string
  4. Call `extractManifestYaml(accumulatedResponse)` to extract the YAML block
  5. Set `generatedManifest` to the extracted YAML, or set `generationError` if extraction returns null
- Handle stream errors by setting `generationError` with a user-facing message
- Never expose raw stream chunks to the caller
- Have zero `any` types
- Import from `@hexagen/agentic-interaction` only — no direct imports from `packages/` internals

### Layer Compliance

- This hook lives in `apps/web/features/manifest-generation/` — application layer
- It may import from `@hexagen/agentic-interaction` (domain package) ✓
- It may import from `@hexagen/local-llm` types via `apps/web/lib/llm-interfaces.ts` ✓
- It must NOT import from `apps/web/app/api/` ✓

### Tests

- [ ] Add `apps/web/features/manifest-generation/__tests__/useClientManifestGeneration.test.ts`
  - Mock `llmContext.sendGovernanceMessage` to return a known async iterable
  - Assert `generatedManifest` is correctly extracted from the mocked stream
  - Assert `generationError` is set when stream yields no valid YAML
  - Assert `isGenerating` transitions correctly through the async lifecycle
  - Use `node:test` and `node:assert`

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

---

## Phase 5 — State Machine Hardening

**Goal:** Ensure `useWelcomeFlowState.ts` fully implements all 9 states and all defined transitions from the canonical state diagram, with no implicit or undocumented transitions. Add `isModelReady` and `interrupted` state support if not already present.

**Preconditions (from Phase 0 audit):**

- Current state of transitions in `useWelcomeFlowState.ts` is documented

### Canonical State Transition Table

| From State          | Event                   | To State                                  |
| ------------------- | ----------------------- | ----------------------------------------- |
| `idle`              | Generate clicked        | `model_selection`                         |
| `model_selection`   | Local model selected    | `model_downloading`                       |
| `model_selection`   | Cloud provider selected | `key_validation`                          |
| `model_selection`   | Cancel clicked          | `idle`                                    |
| `model_downloading` | Download complete       | `generating`                              |
| `model_downloading` | User cancels            | `interrupted`                             |
| `model_downloading` | Download fails          | `error`                                   |
| `interrupted`       | Try again               | `model_selection`                         |
| `interrupted`       | Skip AI                 | `idle`                                    |
| `key_validation`    | Key valid               | `generating`                              |
| `key_validation`    | Key invalid             | `error`                                   |
| `key_validation`    | Back clicked            | `model_selection`                         |
| `generating`        | Generation succeeds     | `preview`                                 |
| `generating`        | Generation fails        | `error`                                   |
| `preview`           | Reject manifest         | `idle` (with preserved manifest in state) |
| `preview`           | Regenerate              | `generating` (with existing description)  |
| `preview`           | Accept manifest         | `wizard_hydration`                        |
| `error`             | Skip AI                 | `idle`                                    |
| `error`             | Try different option    | `model_selection`                         |
| `unsupported`       | (terminal)              | No transitions — WebGPU not available     |

### Files Modified

| File                                                                              | Operation  | Notes                                                                                                     |
| --------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts` | **MODIFY** | Add missing transitions, add `isModelReady`, add `interrupted` state, add `lastRejectedManifest` to state |

### Declarations

**`useWelcomeFlowState.ts` must:**

- Implement every transition in the table above — no undocumented transitions permitted
- Add `isModelReady: boolean` to the return value, derived from `engineState.status === "ready"`
- Add `interrupted` as a handled state with correct transitions back to `model_selection` and to `idle`
- Add `lastRejectedManifest: string | null` to flow state — populated when `preview → idle` (reject) occurs, cleared on `idle → model_selection`
- Add `regenerate` action: transitions `preview → generating` while preserving the original `description` in state
- Expose `aiSetupSkipped: boolean` flag on return value — set to `true` when user transitions to `idle` from `interrupted`, `error`, or `model_selection` via "Skip AI" action
- Maintain `preferLocal: boolean` in state — toggled by provider selection actions
- Have zero `any` types

### Tests

- [ ] Update `apps/web/features/manifest-generation/__tests__/useWelcomeFlowState.test.ts`
  - Add test for every transition in the canonical table
  - Add test for `isModelReady` derivation
  - Add test for `aiSetupSkipped` flag setting and clearing
  - Add test for `lastRejectedManifest` preservation on reject transition
  - Add test for `regenerate` action re-entering `generating` with preserved description

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

---

## Phase 6 — Replace SimpleModelSelection with ModelSettingsView

**Goal:** Embed `ModelSettingsView` from the governance panel into the welcome modal's `model_selection` state, wired to the LLM context. Remove `SimpleModelSelection` usage in `WelcomeScreen`.

**Preconditions:**

- Phase 3 complete: `LocalLLMContext` exposes `switchModel`, `deleteCachedModel`, `loadedModel`, `hasModelInCache`
- Phase 5 complete: `useWelcomeFlowState` exposes `preferLocal` and transition actions
- Phase 0 audit: `ModelSettingsView` props interface is fully documented

### Files Modified

| File                                                                                | Operation  | Notes                                                                               |
| ----------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `apps/web/features/manifest-generation/WelcomeScreen.tsx`                           | **MODIFY** | Replace `SimpleModelSelection` with `ModelSettingsView` in `model_selection` branch |
| `apps/web/features/manifest-generation/ModelSelectionFlow/SimpleModelSelection.tsx` | **RETAIN** | Do not delete — may still be referenced elsewhere; confirm in Phase 0 audit         |

### Props Wiring Table

| ModelSettingsView Prop | Source                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `currentModelId`       | `llmContext.engineState.loadedModelId`                                                                  |
| `loadedModel`          | `llmContext.loadedModel`                                                                                |
| `messagesLength`       | `0` (no chat context in welcome flow)                                                                   |
| `onSwitchModel`        | `llmContext.switchModel`                                                                                |
| `onDeleteModel`        | `llmContext.deleteCachedModel`                                                                          |
| `hasModelInCache`      | `llmContext.hasModelInCache`                                                                            |
| `isLoading`            | `llmContext.engineState.status === "downloading" \|\| llmContext.engineState.status === "loading_vram"` |
| `onSwitchToCloud`      | Sets `preferLocal = false` via state machine action, then transitions to `generating`                   |
| `onBack`               | Calls `cancel` action → transitions to `idle`                                                           |
| `requiresModelWarning` | `true` (user is here because no model was ready)                                                        |

### Declarations

**`WelcomeScreen.tsx` must:**

- Render `ModelSettingsView` when `flowState.state === "model_selection"`
- Pass all props from the wiring table above
- Not pass `onSwitchToCloud` in a way that bypasses the state machine — it must call the state machine action, not manipulate state directly
- Not render `SimpleModelSelection` in the `model_selection` branch (it may still exist as a file)
- Import `ModelSettingsView` from `apps/web/features/governance-assistant/ModelSettingsView` — not from a re-export, to keep the import graph legible
- Remain within hexagonal layer rules (feature → feature import is permitted within the same app)

### Layer Compliance Check

- `manifest-generation` feature importing from `governance-assistant` feature — verify this is permitted by `lint:arch` rules before modifying. If cross-feature imports are forbidden, the correct resolution is to move `ModelSettingsView` to a shared `@hexagen/ui` or `apps/web/components/` location. **Document this decision in the ADR (Appendix C).**

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Manual: Open welcome modal. Click "Generate Manifest". Confirm `ModelSettingsView` renders with no raw errors.

---

## Phase 7 — Fix Local Inference Routing in WelcomeScreen

**Goal:** When `preferLocal === true` and a model is loaded (`isModelReady === true`), use the client-side `useClientManifestGeneration` hook for inference instead of the server API route. When `preferLocal === false`, continue using the existing `fetch("/api/manifest/generate")` server path.

**Preconditions:**

- Phase 4 complete: `useClientManifestGeneration` hook exists and is tested
- Phase 5 complete: `preferLocal` is exposed by state machine
- Phase 6 complete: model selection is wired to context

### Files Modified

| File                                                      | Operation  | Notes                                            |
| --------------------------------------------------------- | ---------- | ------------------------------------------------ |
| `apps/web/features/manifest-generation/WelcomeScreen.tsx` | **MODIFY** | Bifurcate generation path based on `preferLocal` |

### Declarations

**`WelcomeScreen.tsx` generation logic must:**

- When `flowState.state === "generating"`:
  - **If `preferLocal === true`:** Call `useClientManifestGeneration.generateManifest(description)` — no `fetch` call
  - **If `preferLocal === false`:** Call `fetch("/api/manifest/generate")` with the description — existing server path unchanged
- On success (either path): transition to `preview` state with the manifest YAML
- On failure (either path): transition to `error` state with a structured error (see Phase 11 for error taxonomy)
- Never call the server route when `preferLocal === true` — this is the root cause of the bug being fixed

### Bug Fix Verification

This phase directly fixes:

> _"Local model (e.g. Qwen-Coder 0.5B) selection is ignored, error about cloud keys still shown"_

The error originates from `LLMProviderSelectorAdapter` on the server where `webLlmAdapter` is always `null`. By routing local inference entirely client-side, the server route is never reached for local inference, and this error path is bypassed entirely.

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Manual:

1. Open welcome modal → select local model (e.g. Qwen-Coder 0.5B) → wait for load → click Generate → confirm client-side inference runs without "No cloud LLM API keys configured" error
2. Open welcome modal → select cloud → confirm `fetch("/api/manifest/generate")` is called (check Network tab)

---

## Phase 8 — Dialog Shell Improvements

**Goal:** Add backdrop blur to the welcome modal dialog. Add a "Skip AI Setup" close button that calls `onClose` and transitions the state machine to `idle` with `aiSetupSkipped: true`.

**Preconditions:**

- Phase 0 audit: `Dialog.tsx` backdrop class string and `WelcomeManifestDialog.tsx` structure are documented
- Phase 5 complete: `aiSetupSkipped` flag exists in state machine

### Files Modified

| File                                                          | Operation  | Notes                                                                              |
| ------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `packages/ui/src/sections/Dialog.tsx`                         | **MODIFY** | Add `backdrop-blur-sm` to backdrop overlay                                         |
| `apps/web/features/workspace-shell/WelcomeManifestDialog.tsx` | **MODIFY** | Add "Skip AI Setup" button; increase max width; thread `onSkipAI` to WelcomeScreen |

### Declarations

**`Dialog.tsx` must:**

- Change the backdrop overlay class from `backdrop:bg-[hsl(var(--overlay)/0.5)]` to `backdrop:bg-[hsl(var(--overlay)/0.5)] backdrop:backdrop-blur-sm`
- Not change any other Dialog behavior or styling
- Verify the change doesn't break any other Dialog usages in the app (check for visual regressions)

**`WelcomeManifestDialog.tsx` must:**

- Accept and pass an `onSkipAI: () => void` prop to `WelcomeScreen`
- Add a "Skip AI Setup" button in the Dialog footer that:
  - Calls `onSkipAI()` (which sets `aiSetupSkipped: true` in state machine)
  - Calls `onClose()` to dismiss the dialog
- Increase `max-w-4xl` to `max-w-5xl` to accommodate the full `ModelSettingsView` layout
- Button copy: "Skip AI Setup" (not "Cancel" — the user is explicitly opting out of AI, not cancelling the project)

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Manual: Open welcome modal — confirm backdrop blur is visible. Confirm "Skip AI Setup" button dismisses modal cleanly.

---

## Phase 9 — Auto-Transition After Model Load

**Goal:** When the user selects a local model in the `model_selection` state and the model finishes loading (`engineState.status` transitions to `"ready"`), automatically show a "Generate Manifest" button — do not auto-trigger generation (preserve user agency).

**Preconditions:**

- Phase 5 complete: `isModelReady` is exposed by state machine
- Phase 6 complete: `ModelSettingsView` is rendering in `model_selection` state

### Files Modified

| File                                                                              | Operation  | Notes                                                                                   |
| --------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts` | **MODIFY** | Expose `isModelReady` (may already exist from Phase 5) and `selectedModelId`            |
| `apps/web/features/manifest-generation/WelcomeScreen.tsx`                         | **MODIFY** | Render "Generate Manifest" button when in `model_selection` and `isModelReady === true` |

### Declarations

**`WelcomeScreen.tsx` must:**

- When `flowState.state === "model_selection" && isModelReady === true`:
  - Render a "Generate Manifest" CTA button below `ModelSettingsView`
  - Clicking it calls the `startGeneration` action on the state machine, transitioning to `generating`
- When `flowState.state === "model_selection" && isModelReady === false`:
  - Do not render the CTA button
  - `ModelSettingsView`'s own loading/downloading state handles visual feedback during download

**Rationale for not auto-triggering:** The user may want to verify model selection, switch models, or review settings before generating. Auto-generation removes their agency and creates a jarring experience if the model is not the one they intended.

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Manual: Select local model → confirm download progress shows → after load completes, confirm "Generate Manifest" button appears → click → confirm transitions to `generating` state.

---

## Phase 10 — Preference Persistence & Remember Choice

**Goal:** After the user selects a model provider (local or cloud), present a "Remember my choice for future sessions" opt-in checkbox. Persist the choice using `modelPreferencesStorage` when opted in. Returning users with a persisted choice bypass model selection entirely.

**Preconditions:**

- Phase 0 audit: `modelPreferencesStorage` read/write interface and localStorage key names are documented
- Phase 5 complete: `preferLocal` and `aiSetupSkipped` exist in state machine
- Phase 6 complete: `ModelCategorySelector` (or equivalent) is rendering

### Files Modified

| File                                                                                  | Operation              | Notes                                                                                              |
| ------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/web/features/manifest-generation/ModelSelectionFlow/ModelCategorySelector.tsx`  | **MODIFY**             | Add `rememberChoice` checkbox, default `false`                                                     |
| `apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts`     | **MODIFY**             | On init, read persisted preference; skip `model_selection` if returning user with saved preference |
| `apps/web/features/manifest-generation/ModelSelectionFlow/modelPreferencesStorage.ts` | **MODIFY (if needed)** | Add write for `preferLocal` and `rememberChoice` using same key namespace as governance panel      |

### Declarations

**`ModelCategorySelector.tsx` must:**

- Render a checkbox labeled "Remember my choice for future sessions" below the local/cloud selection cards
- Default the checkbox to `false` (opt-in, not opt-out)
- Pass `{ remember: boolean }` alongside the selection choice when calling `onLocalSelected` or `onCloudSelected`

**`useWelcomeFlowState.ts` initialization must:**

- On mount, read from `modelPreferencesStorage`
- If a valid persisted preference exists (`preferLocal` value and `rememberChoice: true`):
  - Set `preferLocal` from the persisted value
  - When the user clicks "Generate Manifest", skip `model_selection` and go directly to:
    - `model_downloading` if `preferLocal === true` and model not yet loaded
    - `generating` if `preferLocal === true` and model already loaded (`isModelReady`)
    - `key_validation` or `generating` if `preferLocal === false` and key exists
  - If `preferLocal === true` but model is not cached, still show `model_selection` (model must be available to proceed)
- If no persisted preference exists, proceed with normal `idle → model_selection` flow

**`modelPreferencesStorage` must:**

- Use the **same localStorage keys** as the governance panel for `preferLocal` and selected model ID
- This ensures governance panel reads the value set during welcome without additional sync logic

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Manual:

1. Fresh session → select local → check "Remember my choice" → generate → close → reopen welcome → confirm model selection is skipped
2. Fresh session → select local → do not check "Remember my choice" → generate → close → reopen welcome → confirm model selection is shown again

---

## Phase 11 — Error Taxonomy & Recovery Paths

**Goal:** Replace the monolithic `error` state with structured error variants. Each error type has specific messaging and specific recovery actions.

**Preconditions:**

- Phase 5 complete: `error` state exists in state machine

### Error Taxonomy

| Error Code           | Trigger                            | User-Facing Message                             | Recovery Options                      |
| -------------------- | ---------------------------------- | ----------------------------------------------- | ------------------------------------- |
| `network_failure`    | Download interrupted by network    | "Download interrupted. Check your connection."  | Retry Download, Switch to Cloud       |
| `model_corrupted`    | Smoke test fails on load           | "Model file appears corrupted."                 | Repair Download, Switch to Cloud      |
| `webgpu_unavailable` | WebGPU not detected on mount       | "Your browser doesn't support local AI models." | Switch to Cloud, Open Browser Guide   |
| `key_invalid_format` | API key fails format validation    | "That doesn't look like a valid API key."       | Try Again (stays in `key_validation`) |
| `key_rejected`       | API key rejected by provider       | "API key was rejected by the provider."         | Try Different Key, Use Local Model    |
| `inference_timeout`  | `sendGovernanceMessage` times out  | "Generation took too long. Try again."          | Retry, Switch Model                   |
| `inference_failed`   | `sendGovernanceMessage` throws     | "Something went wrong during generation."       | Retry, Try Different Option           |
| `no_yaml_extracted`  | `extractManifestYaml` returns null | "AI response didn't contain a valid manifest."  | Retry, Skip AI                        |

### Files Modified

| File                                                                                      | Operation         | Notes                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------- | -------------------- |
| `apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts`         | **MODIFY**        | Add `errorCode: WelcomeFlowErrorCode                                              | null` to error state |
| `apps/web/features/manifest-generation/ModelSelectionFlow/WelcomeFlowError.ts`            | **CREATE**        | `WelcomeFlowErrorCode` union type + `WELCOME_FLOW_ERROR_MESSAGES` record          |
| `apps/web/features/manifest-generation/WelcomeScreen.tsx`                                 | **MODIFY**        | Render error-specific messages and recovery buttons based on `errorCode`          |
| `apps/web/features/manifest-generation/ModelSelectionFlow/UnsupportedHardwareMessage.tsx` | **VERIFY/MODIFY** | Should handle `webgpu_unavailable` specifically — link to canonical browser guide |

### Declarations

**`WelcomeFlowError.ts` must:**

- Export `WelcomeFlowErrorCode` as a string union of all error codes in the taxonomy table
- Export `WELCOME_FLOW_ERROR_MESSAGES: Record<WelcomeFlowErrorCode, string>` with the user-facing messages above
- Export `WELCOME_FLOW_RECOVERY_ACTIONS: Record<WelcomeFlowErrorCode, WelcomeRecoveryAction[]>` defining which actions are available per error

**`useWelcomeFlowState.ts` must:**

- When transitioning to `error`, require a `WelcomeFlowErrorCode` — no untyped error strings
- Expose `errorCode: WelcomeFlowErrorCode | null` on the return value

**`UnsupportedHardwareMessage.tsx` must:**

- Link to canonical browser WebGPU docs via a URL lookup function (not hardcoded browser instructions)
- Support Chromium, Firefox, and Safari as browser targets at minimum
- Fall back to `https://webgpu.io` for unrecognized browsers

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Manual: Simulate each error condition and verify correct message and correct recovery buttons appear.

---

## Phase 12 — Governance Panel Integration

**Goal:** Ensure the governance panel correctly reflects choices made during the welcome flow. Pre-populate model selection from persisted preferences. Surface the `aiSetupSkipped` flag appropriately. Define behavior when the user switches providers mid-project.

**Preconditions:**

- Phase 10 complete: preferences are persisted with the same localStorage keys used by governance panel
- Phase 5 complete: `aiSetupSkipped` flag exists

### Files Modified

| File                                                                | Operation                   | Notes                                                                                                  |
| ------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/web/features/governance-assistant/ModelSettingsView.tsx`      | **MODIFY (possibly no-op)** | If it already reads from the same localStorage keys, confirm it reflects welcome choices automatically |
| `apps/web/features/governance-assistant/` (panel or page component) | **MODIFY**                  | Show `aiSetupSkipped` notification banner                                                              |

### Declarations

**Governance panel must:**

- On first open after welcome flow: display the model that was selected (or the `aiSetupSkipped` notification, whichever applies)
- `aiSetupSkipped` notification: persistent banner reading "AI was not configured during setup. Configure a model here to enable governance features." with a dismiss action that sets a `aiSetupSkippedDismissed: true` flag in localStorage
- Notification must not re-appear after it has been dismissed

**Provider switching (local ↔ cloud) mid-project:**

- Switching from local to cloud: no generated governance content is invalidated — the content already exists, the source model changing does not affect its validity
- Switching from cloud to local: same — existing content is preserved
- Document this decision explicitly: mid-project provider switching does not trigger regeneration of existing governance panel content
- Add a one-time informational toast: "Model changed. Future governance questions will use [new model name]."

### Governance Panel Reframe

The governance panel's role is now:

- **First visit after setup:** Confirmation and audit of the choice made during onboarding
- **Subsequent visits:** Adjustment, monitoring, and governance of AI configuration
- Update panel header/subheading copy to reflect "AI Configuration & Review" rather than implying initial setup

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Manual:

1. Complete welcome flow with local model → navigate to governance panel → confirm model is shown pre-selected
2. Complete welcome flow with "Skip AI Setup" → navigate to governance panel → confirm `aiSetupSkipped` banner appears
3. Dismiss the banner → navigate away → return → confirm banner does not reappear

---

## Phase 13 — Model Cache Integrity (v1 Smoke Test)

**Goal:** After a model downloads, and on subsequent loads of an already-cached model, run a minimal smoke test to detect corruption. Present a "Repair Download" option if the test fails.

**Preconditions:**

- Phase 4 complete: `sendGovernanceMessage` is callable from client-side hook
- Phase 11 complete: `model_corrupted` error code exists in taxonomy

### Files Modified

| File                                                                                  | Operation  | Notes                                                                                       |
| ------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `apps/web/features/manifest-generation/ModelSelectionFlow/modelPreferencesStorage.ts` | **MODIFY** | Add `ModelCacheMetadata` storage: `{ modelId, version, completedAt, verifiedAt \| null }`   |
| `apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts`     | **MODIFY** | Run smoke test after model load; transition to `error` with `model_corrupted` if test fails |

### `ModelCacheMetadata` Interface

```typescript
interface ModelCacheMetadata {
  modelId: string;
  version: string;
  completedAt: number; // Unix timestamp of successful download
  verifiedAt: number | null; // Unix timestamp of last successful smoke test; null = never verified
}
```

### Smoke Test Logic

```
1. After engineState.status transitions to "ready"
2. Attempt: sendGovernanceMessage("test", "Respond with: ok") with a 5-second timeout
3. If response received: update verifiedAt timestamp in cache metadata, proceed normally
4. If timeout or throw: transition to error state with errorCode: "model_corrupted"
5. On "Repair Download": delete cached model from IndexedDB, clear ModelCacheMetadata, re-initiate download
```

### Declarations

**Smoke test must:**

- Only run once per `(modelId, version)` pair per session — use `verifiedAt` to skip if recently verified (within 24 hours)
- Have a hard 5-second timeout — do not block the user indefinitely
- Not run in the governance panel flow (only in the welcome flow where model freshness is first established)

### Verification Gate

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

Manual: Simulate corrupted model (mock `sendGovernanceMessage` to throw) → confirm "Repair Download" prompt appears.

---

## Phase 14 — Final Integration Verification

**Goal:** Confirm the complete end-to-end flow works across all paths, all verification gates pass, and no regressions exist in unrelated features.

### End-to-End Test Scenarios

| Scenario                                    | Expected Outcome                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| New user, local model, accepts manifest     | Model selection → download → smoke test → generation → preview → wizard hydrated                  |
| New user, local model, rejects manifest     | preview → idle with `lastRejectedManifest` preserved → regenerate option visible                  |
| New user, cloud provider, valid key         | key_validation → generation → preview → wizard hydrated                                           |
| New user, cloud provider, invalid key       | key_validation → error (key_rejected) → recovery options shown                                    |
| New user, skips AI setup                    | aiSetupSkipped=true → dialog closes → governance panel shows banner                               |
| Returning user, remembered local preference | model_selection skipped → direct to generating (if model loaded) or downloading                   |
| Returning user, model corrupted             | smoke test fails → model_corrupted error → Repair Download offered                                |
| WebGPU unavailable                          | Local option disabled on model_selection → only cloud shown → UnsupportedHardwareMessage rendered |
| Download interrupted mid-way                | interrupted state → "Try Again" → model_selection or "Skip AI" → idle                             |
| Manifest generation timeout                 | inference_timeout error → retry or switch model recovery                                          |

### Final Verification Gates

```bash
# All must pass with zero errors
yarn build
yarn typecheck
yarn lint
yarn lint:arch

# All test files must pass
yarn test
```

### Regression Check

- [ ] Confirm governance panel functions identically for users who never opened the welcome modal
- [ ] Confirm `ModelSettingsView` in governance panel has no prop type regressions from Phase 3 interface expansion
- [ ] Confirm `Dialog` backdrop blur change has no unintended visual effects on other dialogs in the app
- [ ] Confirm `@hexagen/agentic-interaction` server-side use case still functions (Phase 1 extraction must not have changed behavior)

---

## Appendix A — State Machine Reference

```
stateDiagram-v2
    [*] --> idle

    idle --> model_selection : Generate clicked (no saved preference)
    idle --> model_downloading : Generate clicked (saved preference: local, model not cached)
    idle --> generating : Generate clicked (saved preference: local, model ready)
    idle --> key_validation : Generate clicked (saved preference: cloud)

    model_selection --> model_downloading : Local model selected
    model_selection --> key_validation : Cloud provider selected
    model_selection --> idle : Cancel / Skip AI

    model_downloading --> generating : Download complete + smoke test passes
    model_downloading --> interrupted : User cancels
    model_downloading --> error : Download fails (network_failure)
    model_downloading --> error : Smoke test fails (model_corrupted)

    interrupted --> model_selection : Try again
    interrupted --> idle : Skip AI

    key_validation --> generating : Key valid
    key_validation --> error : Key invalid (key_rejected / key_invalid_format)
    key_validation --> model_selection : Back clicked

    generating --> preview : Generation succeeds
    generating --> error : Generation fails (inference_failed / inference_timeout / no_yaml_extracted)

    preview --> idle : Reject manifest (preserves lastRejectedManifest)
    preview --> generating : Regenerate (preserves description)
    preview --> wizard_hydration : Accept manifest

    error --> idle : Skip AI
    error --> model_selection : Try different option
    error --> key_validation : Try different key (key errors only)

    unsupported --> [*] : Terminal — only cloud option available
```

---

## Appendix B — Component Tree Reference

```
WelcomeManifestDialog.tsx
└── WelcomeScreen.tsx
    ├── [state: idle]
    │   └── ProjectDescriptionInput + "Generate Manifest" CTA
    │
    ├── [state: model_selection]
    │   ├── ModelSettingsView.tsx (from governance-assistant)
    │   │   ├── ModelSettingsHeader.tsx
    │   │   ├── WarningBanner.tsx (requiresModelWarning=true)
    │   │   ├── ModelTierSection.tsx
    │   │   ├── CloudModelsSection.tsx
    │   │   └── StorageFooter.tsx
    │   ├── ModelCategorySelector.tsx (remember choice checkbox)
    │   └── [if isModelReady] "Generate Manifest" button
    │
    ├── [state: model_downloading]
    │   └── DownloadProgressIndicator.tsx
    │
    ├── [state: key_validation]
    │   └── CloudProviderForm.tsx
    │
    ├── [state: generating]
    │   └── ManifestGenerationIndicator.tsx
    │
    ├── [state: preview]
    │   ├── ManifestPreview.tsx
    │   └── Accept / Reject / Regenerate actions
    │
    ├── [state: interrupted]
    │   └── InterruptedView.tsx (Try Again / Skip AI)
    │
    ├── [state: error]
    │   └── ErrorView.tsx (message from WelcomeFlowErrorCode, recovery actions)
    │
    └── [state: unsupported]
        └── UnsupportedHardwareMessage.tsx
```

---

## Appendix C — Architectural Decision Log

| Decision                                                             | Rationale                                                                                                                                                           | Date |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Client-side local inference only                                     | WebGPU/Worker APIs are browser-only; Next.js API routes run in Node.js where `webLlmAdapter` is always null. Server routes remain for cloud-only generation.        | —    |
| Reuse `sendGovernanceMessage` for manifest generation                | The hook already handles streaming, model selection, and error handling. Reimplementing for manifests duplicates logic and creates divergence risk.                 | —    |
| Extract YAML parsing to shared utility                               | Both server (use case) and client (welcome hook) generation paths must produce identical YAML extraction behavior. Shared utility guarantees this.                  | —    |
| `rememberChoice` defaults to `false`                                 | Governance-focused enterprise tool. Users should explicitly consent to persistence. Opt-in aligns with expectations around what gets stored and where.              | —    |
| Preserve `lastRejectedManifest` on reject                            | Manifest generation is not instant. Losing output on a single click creates frustration, especially with local inference which may have taken tens of seconds.      | —    |
| `preview → reject` does not auto-clear                               | User retains the rejected manifest in state until they explicitly regenerate or close, giving them time to reference it.                                            | —    |
| Governance panel becomes "review not setup"                          | Welcome modal handles first-time model selection. Governance panel's role shifts to audit, confirmation, and ongoing adjustment.                                    | —    |
| Smoke test timeout: 5 seconds                                        | Balances detection sensitivity vs. user wait time. A healthy model generating a single token should respond in well under 5 seconds.                                | —    |
| No chunk-level hash verification in v1                               | Engineering cost of chunk verification is high; smoke test catches 90% of corruption cases. Hash verification deferred to post-v1 based on production failure data. | —    |
| Mid-project provider switching does not invalidate content           | Governance content validity is not tied to the model that generated it. Forcing regeneration on model switch would be disruptive and lose user work.                | —    |
| Cross-feature import: `manifest-generation` → `governance-assistant` | Verify `lint:arch` permits this before Phase 6. If forbidden, relocate `ModelSettingsView` to `apps/web/components/` shared layer.                                  | —    |
