Goal
- Fix welcome modal flow so users are presented with model selection (reusing ModelSettingsView) instead of a raw error when no cloud API keys exist, and ensure local/WebLLM model selection is respected when generating manifests.
Constraints & Preferences
- Hexagonal/DDD architecture must be maintained (yarn lint:arch must pass)
- All checks must pass: yarn build && yarn typecheck && yarn lint && yarn lint:arch
- No any types allowed (ESLint rule @typescript-eslint/no-explicit-any: error)
- Tests use node:test + node:assert (not vitest/jest)
- Follow AGENTS.md Develop Mode rules (ToC, file-by-file, verify each)
Progress
Done
- Removed mock data override (useMockLLM check) from both apps/web/app/api/manifest/generate/route.ts and apps/web/app/api/manifest/generate/local/route.ts
- Integrated useWelcomeFlowState state machine into WelcomeScreen.tsx (replaced legacy useManifestGeneration)
- Connected SimpleModelSelection.tsx to state machine actions
- Exported LocalLLMContext type from @hexagen/local-llm package (packages/local-llm/src/domain/ports/local-llm-context.type.ts)
- Updated apps/web/lib/llm-interfaces.ts to re-export from package
- Added test files: apps/web/__tests__/api/manifest/generate.test.ts and apps/web/features/manifest-generation/__tests__/useWelcomeFlowState.test.ts
- Fixed Next.js prerendering error by adding export const dynamic = 'force-dynamic' to apps/web/app/page.tsx
- All verification gates pass (build, typecheck, lint, lint:arch)
In Progress
- Redesigning welcome modal UX: when user clicks "Generate Manifest" without a model selected, show model selection screen instead of error
- Reusing apps/web/features/governance-assistant/ModelSettingsView.tsx within the welcome modal flow
- Adding "Proceed with AI Generated Manifest" cancel button that closes the modal
- Adding background blur when modal is open
- Fixing bug: local model (e.g. Qwen-Coder 0.5B) selection is ignored, error about cloud keys still shown
- Persisting model selection using existing preference storage code
Blocked
- (none)
Key Decisions
- Removed mock data entirely rather than conditionally enabling it — mock bypass was the root cause of users seeing fake data regardless of their model selection
- useWelcomeFlowState is the canonical state machine for the welcome flow (9 states: idle, model_selection, model_downloading, key_validation, generating, preview, error, interrupted, unsupported, wizard_hydration)
- ModelSettingsView.tsx from governance-assistant should be reused inside the welcome modal for model selection — do not duplicate
Next Steps
- Read ModelSettingsView.tsx fully and its sub-components (model-settings/) to understand its props interface and how to embed it in WelcomeScreen
- Read the error-path code in WelcomeScreen.tsx and useWelcomeFlowState.ts that produces "No cloud LLM API keys configured" — fix to route to model selection instead
- Wire ModelSettingsView into WelcomeScreen for the model_selection state, passing onSwitchModel that connects to the LLM context
- Add "Proceed with AI Generated Manifest" cancel button to the model selection view that calls onClose
- Add backdrop blur to WelcomeManifestDialog.tsx (Dialog component styling)
- Ensure preferLocal flag and persisted model selection are respected in the API route call (currently the bug: local model selected but cloud key error shown)
- Fix the data flow: when user has a local model selected, the generate call must use local inference, not check for cloud API keys
- Run all verification gates after changes
Critical Context
- The "No cloud LLM API keys configured" error likely originates from LLMProviderSelectorAdapter when webLlmAdapter is null (server-side) and no cloud keys exist — need to allow client-side WebLLM execution path
- ModelSettingsView requires props: currentModelId, loadedModel, messagesLength, onSwitchModel, onDeleteModel, hasModelInCache, isLoading, onSwitchToCloud, requiresModelWarning
- Model preferences are persisted via modelPreferencesStorage (imported in useWelcomeFlowState.ts)
- WelcomeManifestDialog.tsx uses @hexagen/ui Dialog component — backdrop blur can be added via DialogContent className or Dialog overlay styling
- SimpleModelSelection.tsx is the current (simpler) model selection component inside WelcomeScreen — it may be replaced or supplemented by ModelSettingsView
Relevant Files
- apps/web/features/governance-assistant/ModelSettingsView.tsx: Reusable model selection view to embed in welcome modal
- apps/web/features/governance-assistant/model-settings/: Sub-components (ModelSettingsHeader, WarningBanner, ModelTierSection, CloudModelsSection, StorageFooter)
- apps/web/features/manifest-generation/WelcomeScreen.tsx: Main welcome screen — needs model selection integration
- apps/web/features/workspace-shell/WelcomeManifestDialog.tsx: Dialog wrapper — needs backdrop blur + close-on-cancel
- apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts: State machine with 9 states and actions
- apps/web/features/manifest-generation/ModelSelectionFlow/SimpleModelSelection.tsx: Current simple model selector
- apps/web/features/manifest-generation/ModelSelectionFlow/modelPreferencesStorage.ts: Persists model preferences
- packages/local-llm/src/domain/ports/local-llm-context.type.ts: LocalLLMContext type definition
- apps/web/app/api/manifest/generate/route.ts: API route (mock removed, but cloud-key check still blocks local LLM)
- apps/web/app/api/manifest/generate/local/route.ts: Local LLM API route

---

Plan: Welcome Modal Model Selection Fix
Problem Summary
Two interconnected bugs:
1. Local model selection is ignored — when a user selects a local model (e.g. Qwen-Coder 0.5B), the API route still checks for cloud API keys and errors with "No cloud LLM API keys configured" because WebLLMAdapter is null on the server (no Worker global), so LLMProviderSelectorAdapter falls back to cloud, which has no keys.
2. No model selection in welcome modal — when no model is configured, users see a raw error instead of being routed to model selection.
Root Cause
The API routes (/api/manifest/generate and /api/manifest/generate/local) run server-side in Next.js. WebLLMAdapter requires browser APIs (WebGPU, Worker) which don't exist server-side. So webLlmAdapter is always null on the server, making local LLM impossible through this path. The local LLM inference can only happen client-side via the useLocalLLM hook.
Architectural Constraint
WebLLM runs in the browser. Server-side API routes cannot execute local models. The current architecture tries to wire WebLLM on the server — this is fundamentally broken. The fix must route local inference through the client-side useLocalLLM hook, not through server API routes.
---
Phase 1: Client-Side Local LLM Generation Path
Files to modify:
1. apps/web/features/manifest-generation/WelcomeScreen.tsx — Add a client-side generation path using llmContext.sendGovernanceMessage() when preferLocal is true, instead of hitting the server API route
2. apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts — Expose sendGovernanceMessage from the LLM context for the generation flow
Logic:
- When preferLocal=true and a local model is loaded (engineState.status === "ready"), call llmContext.sendGovernanceMessage(description, systemPrompt) client-side instead of fetch("/api/manifest/generate/local")
- Parse the streaming response into a manifest YAML
- Only fall back to the server route when preferLocal=false (cloud path)
Phase 2: Replace SimpleModelSelection with ModelSettingsView in Welcome Modal
Files to modify:
1. apps/web/features/manifest-generation/WelcomeScreen.tsx — Replace SimpleModelSelection with ModelSettingsView in the model_selection state branch. Wire onSwitchModel to llmContext.switchModel, hasModelInCache to llmContext.hasModelInCache, etc.
2. apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts — Add a modelLoaded boolean derived from engineState.status === "ready" so WelcomeScreen knows when to auto-advance from model_selection to generating
Props wiring for ModelSettingsView:
- currentModelId → llmContext.engineState.loadedModelId
- loadedModel → llmContext.loadedModel
- messagesLength → llmContext.messages.length (or 0 if no chat started)
- onSwitchModel → llmContext.switchModel
- onDeleteModel → llmContext.deleteCachedModel
- hasModelInCache → llmContext.hasModelInCache
- isLoading → llmContext.engineState.status === "downloading" || "loading_vram"
- onSwitchToCloud → sets preferLocal=false and transitions to generating
- onBack → transitions back to "idle"
- requiresModelWarning → true (since user is here to pick a model)
Phase 3: "Skip AI" / Close Button & Backdrop Blur
Files to modify:
1. apps/web/features/workspace-shell/WelcomeManifestDialog.tsx — Add backdrop-blur-sm to DialogContent; add a "Skip AI Setup" button that calls onClose
2. packages/ui/src/sections/Dialog.tsx — Add backdrop-blur-sm to the <dialog> element's backdrop: pseudo-class style (change backdrop:bg-[hsl(var(--overlay)/0.5)] to include backdrop-blur-sm)
Phase 4: Auto-Transition After Model Load
Files to modify:
1. apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts — When engineState.status transitions to "ready" and flowState.state === "model_selection", auto-set selectedModelId and prepare for generation
2. apps/web/features/manifest-generation/WelcomeScreen.tsx — After model is loaded in the model_selection view, show a "Generate Manifest" button (model is ready)
Phase 5: Verification
- yarn build && yarn typecheck && yarn lint && yarn lint:arch
- Manual test: open welcome modal → select local model → model downloads → "Generate" appears → click generate → client-side inference runs → manifest preview shown
- Manual test: open welcome modal → select cloud → no API key → helpful error (not raw "No cloud LLM API keys configured")
- Manual test: skip AI setup → modal closes, user can proceed manually
---
Key Design Decision
Client-side vs server-side local inference: The current broken path attempts to create WebLLMAdapter in a Next.js API route, which will always be null because WebGPU/Worker don't exist in Node.js. The fix routes local inference entirely through the client-side useLocalLLM hook. The server API routes remain for cloud-only generation.

---

Problem
1. Local model selection is ignored — WebLLMAdapter is always null server-side, so API routes fall back to cloud and error with "No cloud LLM API keys configured"
2. No proper model selection UX in the welcome modal — users see a raw error instead of a model picker
Solution Architecture
Local LLM inference must happen client-side (WebGPU/Worker APIs are browser-only). Cloud inference continues through server API routes. The welcome flow must bifurcate based on preferLocal:
- Local path: Use sendGovernanceMessage() from useLocalLLM() hook to run inference client-side, then extract YAML from the streamed response
- Cloud path: Use existing fetch("/api/manifest/generate") server route
Phase 1: Add client-side manifest generation using sendGovernanceMessage
Files:
1. apps/web/features/manifest-generation/useClientManifestGeneration.ts (NEW)
   - Hook that wraps sendGovernanceMessage for manifest generation
   - Imports SYSTEM_PROMPT and compileUserPrompt from @hexagen/agentic-interaction (the existing prompt used by the use case)
   - Returns { generateManifest, isGenerating, generationError, generatedManifest }
   - Uses sendGovernanceMessage(description, systemPrompt) from useLocalLLM()
   - Collects streamed response into a string, then extracts YAML using the same extractYamlFromResponse logic from GenerateManifestFromDescriptionUseCase
2. apps/web/features/manifest-generation/WelcomeScreen.tsx (MODIFY)
   - Import the new hook and useLocalLLM
   - When preferLocal=true and in generating state: use the client-side hook instead of fetch
   - When preferLocal=false: use existing server-side fetch path
   - Replace SimpleModelSelection with ModelSettingsView in the model_selection state branch
   - Wire ModelSettingsView props to llmContext values:
     - onSwitchModel → llmContext.switchModel
     - onDeleteModel → llmContext.deleteCachedModel
     - hasModelInCache → llmContext.hasModelInCache
     - currentModelId → llmContext.engineState.loadedModelId
     - loadedModel → llmContext.loadedModel
     - isLoading → derived from engine state
     - onSwitchToCloud → sets preferLocal=false, transitions to "idle" with cloud path
     - onBack → transitions to "idle"
     - messagesLength → 0 (no chat in welcome context)
     - requiresModelWarning → true
   - After model is loaded (engineState.status === "ready" in model_selection), show a "Generate Manifest" button
3. apps/web/lib/llm-interfaces.ts (MODIFY)
   - Re-export ChatMessage type (already done) and add ModelMetadata if needed by ModelSettingsView
Phase 2: Update useWelcomeFlowState for client-side generation
Files:
4. apps/web/features/manifest-generation/ModelSelectionFlow/useWelcomeFlowState.ts (MODIFY)
   - Add isModelReady derived state: engineState.status === "ready"
   - When flowState.state === "model_downloading" and engineState.status === "ready", auto-transition to "model_selection" (model loaded, show "Generate" button)
   - Expose isModelReady on WelcomeFlowActions or WelcomeFlowState
   - Pass sendGovernanceMessage through from LocalLLMContext or the new hook
Phase 3: Dialog improvements (blur + close/skip button)
Files:
5. packages/ui/src/sections/Dialog.tsx (MODIFY)
   - Change backdrop:bg-[hsl(var(--overlay)/0.5)] to include blur: backdrop:bg-[hsl(var(--overlay)/0.5)] backdrop-blur-sm
6. apps/web/features/workspace-shell/WelcomeManifestDialog.tsx (MODIFY)
   - Add a "Skip AI Setup" button that calls onClose — user can close the dialog and proceed without AI
   - Increase max-w-4xl to max-w-5xl for model settings view
Phase 4: Handle LocalLLMContext type expansion
The issue: LocalLLMContext from @hexagen/local-llm only exposes engineState, initializeModel, cancelDownload, hasAnyCachedModel, hasModelInCache. But WelcomeScreen needs switchModel, deleteCachedModel, loadedModel, sendGovernanceMessage, messages which come from the full useLocalLLM hook (which returns LocalLLMContextValue).
Solution:
7. apps/web/lib/llm-interfaces.ts (MODIFY)
   - Change the re-export to use the full LocalLLMContextValue interface from useLocalLlm.tsx instead of the narrower LocalLLMContext from the package
   - OR: Expand LocalLLMContext in the @hexagen/local-llm package to include the full set of methods
8. apps/web/features/workspace-shell/ProjectWorkspace.tsx (VERIFY)
   - Already passes llmContext (from useLocalLLM()) to WelcomeManifestDialog → WelcomeScreen
   - Confirm the type matches
Phase 5: Extract YAML extraction logic into shared utility
Files:
9. packages/agentic-interaction/src/domain/value-objects/manifest-yaml-extractor.ts (NEW)
   - Extract extractYamlFromResponse, generateSuggestions, detectWarnings from GenerateManifestFromDescriptionUseCase into a standalone utility
   - This allows reuse from the client-side generation path
10. packages/agentic-interaction/src/application/use-cases/generate-manifest-from-description.use-case.ts (MODIFY)
    - Import from the new utility module instead of having private methods
Phase 6: Export SYSTEM_PROMPT and compileUserPrompt for client-side use
Files:
11. packages/agentic-interaction/src/domain/prompts/generate-manifest.prompt.ts (VERIFY)
    - Already exports SYSTEM_PROMPT and compilePrompt / compileUserPrompt — confirm these are re-exported from the package's public API
12. packages/agentic-interaction/src/index.ts (VERIFY)
    - Confirm SYSTEM_PROMPT, compilePrompt, compileUserPrompt, PromptVariables are exported
Phase 7: Verification
- yarn build && yarn typecheck && yarn lint && yarn lint:arch
- Manual test scenarios:
  1. Open welcome modal → model selection → pick local model → model loads → "Generate" appears → click generate → client-side inference → manifest preview
  2. Open welcome modal → model selection → "Switch to Cloud" → cloud generation path
  3. Open welcome modal → "Skip AI Setup" → dialog closes
  4. Dialog backdrop blur visible when modal is open
---
Key Architectural Decisions
- No server-side WebLLM: The API routes' WebLLMAdapter creation is dead code on the server. We do NOT remove it (it could theoretically work in a Web Worker in edge runtime someday), but the client-side path bypasses it entirely for local inference.
- Reuse sendGovernanceMessage: The useLocalLLM hook already handles streaming, model selection, and error handling. We reuse it rather than reimplementing.
- Reuse SYSTEM_PROMPT: The manifest generation prompt is already well-defined. We import it directly rather than duplicating.
- Extract YAML parsing: Shared utility so both server and client paths use identical extraction logic.

---

