# React Performance Remediation Plan

**Sources of Truth**
- Evidence Base: `docs/react-performance-audit.md` (violation details, line numbers, root cause)
- Dependency Graph: `docs/react-performance-blast-radius-map.md` (Tier 1/2 traces, hot spots)
- Validation Protocol: Audit §302-341 (profiler baselines, measurement)
- Profiler Captures: `perf/baselines/` (3 scenarios captured 2026-05-09)

## Execution Sequence

| Step | Action | Status | Commit |
|------|--------|--------|--------|
| 1 | Run profiling baselines | **Done** | N/A |
| 2 | Diagnose GraphCanvasInner hook[5] feedback loop | **Closed — no loop** | N/A |
| 3 | Fix GovernanceAssistantPanel + useCloudLlm callback deps | **Done** | `937e7747` |
| 4 | Eliminate wizardData identity churn + loadGraph cascade | **Done** | `04f36282` |
| 5 | Fix useProjectLifecycle form dependencies | **Done** | `8085e734` |
| 6 | Apply Tabs context useMemo | **Closed — no context** | N/A |
| 7 | Split LocalLLMProvider context (streaming isolation) | **Done** | `341df638` |
| 8 | Add selector to useCanvasGraphStore + identity-preserving FlowNode mapping | **Done** | `341df638` |
| 9 | Scope FormProvider + React.memo on ArchitecturePreviewPane/GovernancePanelWrapper | **Done** | `4ce48cff` |
| 10 | Move form subscriptions to WizardLifecycleProvider (ProjectWorkspace stable) | **Done** | `a9c1eb5a` |
| 11 | Eliminate PanelResizeHandle noise + isolate PanelGroup from form state cascade | **Done** | — |
| 12 | Leaf-node useController in WorkspaceGovernanceStep | **Planned** | — |

## Profiler Baseline Results (2026-05-09)

### Scenario A: Single Keystroke in Wizard
**File**: `perf/baselines/profiling-single-key-input-data.05-09-2026.16-48-38.json`

| Metric | Value |
|--------|-------|
| Total commits | 14 |
| Total render time | 47.9ms |
| Max single commit | 26.7ms (ProjectWorkspace update) |
| GraphCanvasInner renders | 4 (16.6ms total) |
| ArchitecturePreviewPane renders | 4 (10.4ms) |
| Canvas subtree fibers re-rendered | ~30+ |
| GovernanceAssistantPanel renders | 1 (7.3ms) |
| Unnecessary render instances | 289 across 150 components |

**Cascade**: `ProjectWorkspace` context change → `GraphCanvasInner` (4x) → ReactFlow tree (12 NodeWrappers + 6 EdgeWrappers × 2) → 30+ canvas fibers

### Scenario B: Single Node Drag
**File**: `perf/baselines/profiling-data-react-flow-single-node-move.05-09-2026.16-49-11.json`

| Metric | Value |
|--------|-------|
| Total commits | 7 |
| Total React commit duration | 12.40ms |
| Total fiber self-duration | 34.30ms |
| Max single commit | 4.90ms |
| NodeWrapper total renders | 26 (all 12 nodes) |
| EdgeWrapper total renders | 12 (all 6 edges) |
| Viewport resets | 0 |
| Zustand per-frame re-renders | No (React batched) |

**Finding**: All NodeWrappers/EdgeWrappers re-render even when only 1 node dragged — no individual node subscription selector. Post-drag commits (#5-6) re-render entire graph tree due to Zustand `nodes`/`edges` array reference change.

### Scenario C: Governance Assistant Streaming (5s)
**File**: `perf/baselines/profiling-data-governance-assistant-streaming-5sec.05-09-2026.16-52-09.json`

| Metric | Value |
|--------|-------|
| Total commits | 422 |
| Commits/second | 31.2 |
| Total component render calls | 26,140 |
| GovernanceAssistantPanel renders | 422 (7.60ms avg) |
| Total governance self-time | 2,024.6ms |
| Canvas re-renders during streaming | **0** (correctly isolated) |
| Streaming interval median | 25.7ms |

**Root cause**: `LocalLLMProvider` re-renders on every streaming token via `hooks[26]`, propagating through Context.Provider to ALL consumers — including unrelated components outside the governance panel tree. **Fix: Split streaming state into a separate context.**

## Fix Instructions (with Correctness Constraints)

### Step 2: Canvas Cascade (CLOSED — no feedback loop)
**Diagnosis completed 2026-05-09.** Hook enumeration confirmed hook[5] = `useState(isLoaded)` from `useCanvasLayout.ts:21` — a `useState`, not a `useEffect`. No feedback loop exists in `GraphCanvasWrapper.tsx` or any related file. The profiler's alternating commit pattern is a **one-way settling cascade** caused by `wizardData` identity churn propagating through `loadGraph`. Each keystroke triggers: `wizardData` change → `loadGraph` → `setLayoutCalculating(true)` → ELK async → `setLayoutCalculating(false)` + `setGraph` + `setState(viewport)` → 5–6 React commits. The cascade terminates because ELK is not called in a loop, but it runs the full layout pipeline per keystroke. **Root cause is upstream** — `wizardData` gets a new identity on every keystroke (from `watch()` in wizard forms). The fix is Step 4 (watch() decomposition), not a canvas-level change. Additionally: M10 (`use-canvas-viewport-manager.ts:38` — `state` as broad `useEffect` dep) is a valid optimization but not a loop source. The `useCanvasGraphStore()` call at `useCanvasState.ts:69` lacks a selector (subscribes to entire store) — also a valid optimization but not a loop source.

### Step 3: Cloud Connection Callbacks (DONE — commit `937e7747`)
**Files changed**: `GovernanceAssistantPanel.tsx`, `useCloudLlm.ts`
- 3 named callbacks (handleCloudConnect, handleCloudDisconnect, handleRetryConnection) → useRef pattern for cloudConnection/cloudLLM
- 3 inline arrows (onSwitchToCloud, onResetConfig, onSendMessage) → stable useCallback with empty deps + ref reads
- sendMessage in useCloudLlm.ts: replaced `state.messages` dep with `messagesRef.current`
- vault retained in dep arrays (stable singleton from useContext)

### Step 4: wizardData Identity Churn (DONE — commit `04f36282`)
**Files changed**: `useWizardForm.ts`, `useCanvasState.ts`

**4a — useWizardForm.ts**: Content-keyed `wizardData` via hash-gated ref. `buildWizardData` only runs when `JSON.stringify` output changes, not on every `useWatch` identity churn. Uses `stableHash()` + `useRef` pattern:
```ts
const contentHash = useMemo(() => stableHash({...}), [boundedContexts, ...]);
if (contentHash !== prevHashRef.current) {
  wizardDataRef.current = buildWizardData(...);
}
```

**4b — useCanvasState.ts useEffect**: Replaced `wizardData` in dep array with `wizardDataHash` (content-derived signal from `generateManifestHash`), so `loadGraph` only fires on actual manifest content changes.

**4c — useCanvasState.ts loadGraph**: Early-exit when `manifestHash === newHash && manifestHash !== null` — skips `regenerateGraphFromWizard`, `setGraph`, `setManifestHash`, and viewport reset entirely.

**Expected impact**: 0 canvas commits per keystroke when only governance text fields change (workspaceName, description, etc.). Canvas still re-renders on structural changes (add/remove contexts, toggle ports).

### Step 5: useProjectLifecycle Form Dependencies (DONE — commit `8085e734`)
**Location**: `apps/web/features/workspace-shell/hooks/useProjectLifecycle.ts`, `useProjectDialogHandlers.ts`
- **Prerequisite**: Only after Step 4 complete ✅
- **Action**: Applied `useRef(form)` pattern (`formRef`) to all 6 `form` usages:
  1. `useEffect` (L107): `form.reset()` → `formRef.current.reset()`; removed `form` from deps
  2. `handleNext` (L120-142): `form.trigger()` + `form.getValues()` → `formRef.current.trigger/getValues`; removed `form` from deps
  3. `handleLoadProject` (L149-174): `form.reset()` → `formRef.current.reset()`; removed `form` from deps
  4. `handleGenerate` (L176-178): `form.getValues()` → `formRef.current.getValues()`; removed `form` from deps
  5. `handleSaveAndNew` (L180-208): `form.getValues()` + `form.reset()` → `formRef.current.*`; removed `form` from deps
  6. `handleDiscardAndNew` (L210-224): `form.reset()` → `formRef.current.reset()`; removed `form` from deps
- **Also fixed**: `useProjectDialogHandlers.ts` — `handleManifestLoaded` had `form` in deps; replaced with `formRef.current.reset()`
- **Correctness**: All `form` usages are invocation-time reads/writes (button clicks, effect-side writes) — none are reactive dependencies. `formRef` is safe per audit §6 ref-escape rules.
- **Expected impact**: 6 callbacks + 1 useEffect no longer invalidated on every keystroke; eliminates H5 cascade (form object identity churn)

### Step 6: Tabs Context Memoization (CLOSED — no context exists)
**Location**: N/A
- **Diagnosis**: No `TabsContext` or `createContext` for tabs exists in the codebase. `ResponsiveTabs.tsx` uses plain `useState` — no Context.Provider. `ManifestPreview.tsx` also uses local `useState`. The plan's Step 6 was based on a pre-profiling assumption. The profiler confirmed minimal impact.
- **Result**: No-op. Existing `useState`-based tab implementations don't create context propagation overhead.

### Step 7: Split LocalLLMProvider Context (DONE — from Scenario C profiling)
**Location**: `apps/web/features/llm-driver/useLocalLlm.tsx`
- **Problem**: LocalLLMProvider re-renders 416× during 5s streaming (every token), propagating through Context.Provider to ALL consumers — including components outside the governance tree (SegmentBoundaryTriggerNode, etc.)
- **Action**: Split into two contexts:
  1. **LocalLLMConfigContext** (stable): model settings, engine state, connection status
  2. **LocalLLMStreamingContext** (volatile): messages, isStreaming, streaming content
- Consumers that don't need streaming tokens subscribe to the stable context only
- **Expected impact**: ~416 unnecessary context propagations eliminated during streaming

### Step 8: Canvas Store Selector + Identity-Preserving FlowNode Mapping (DONE)
**Location**: `useCanvasState.ts`, `useCanvasConfig.ts`
- **Problem**: Two-part issue found in Scenario B profiling:
  1. `useCanvasGraphStore()` at `useCanvasState.ts:85` called without selector — subscribes to entire store; re-renders on every store change including action identity shifts
  2. `mapToFlowNodes()` in `useCanvasConfig.ts` creates new FlowNode objects for ALL nodes on every `nodes` array change — even when only 1 node's position changed, all 12 NodeWrappers + 6 EdgeWrappers re-render because each gets a new `data` prop reference

- **8a — useShallow selector** (`useCanvasState.ts`):
  - Added `useShallow` from `zustand/react/shallow` to the `useCanvasGraphStore` call
  - Selects only `nodes`, `edges`, `manifestHash`, `isLayoutCalculating` + action functions
  - Prevents re-renders from action function identity changes (though Zustand actions are stable, the bare hook's destructured object creates a new reference each render)

- **8b — Identity-preserving FlowNode/FlowEdge mapping** (`useCanvasConfig.ts`):
  - Ref-based cache (`nodeCacheRef`, `edgeCacheRef`) keyed by node/edge ID
  - Cache stores `{ source: HexagonNode, flow: FlowNode }` — reuses previous FlowNode when the source HexagonNode reference is identical (`===`)
  - On node drag: Zustand's `updateNodePosition` creates new array via `.map()`, but only the dragged node gets a new object reference — unchanged nodes keep their original reference → cache hit → same FlowNode object → React.memo skips re-render
  - `mapToFlowNodes` / `mapToFlowEdges` now return `{ flowNodes, nextCache }` so the hook can persist the updated cache to the ref
  - Helper `toFlowNode` / `mapToFlowEdge` extracted for single-node/edge mapping

- **Correctness**: The cache uses referential equality (`===`) on the source HexagonNode objects. This is safe because Zustand's `.map()` only creates new objects for changed entries. When `setGraph` replaces all nodes (e.g. after ELK layout), all cache entries miss → all FlowNodes rebuilt → correct.

- **Expected impact**: Dragging 1 node → only 1 NodeWrapper re-renders (the dragged one) + 0 EdgeWrapper re-renders (edges unchanged). Pre-fix: 12 NodeWrappers + 6 EdgeWrappers all re-rendered.

### Step 9: Scope FormProvider + React.memo on Siblings (DONE — commit `4ce48cff`)
**Files changed**: `ProjectWorkspace.tsx`, `ArchitecturePreviewPane.tsx`, `GovernancePanelWrapper.tsx`

- **9a — Scoped FormProvider**: Moved `<FormProvider>` from wrapping the entire `ResizableLayout` to wrapping only `<WizardStepRouter>` inside `ProjectWorkspace.tsx`.
- **9b — React.memo on siblings**: Wrapped `ArchitecturePreviewPane` and `GovernancePanelWrapper` in `React.memo` to block cascading re-renders from `ProjectWorkspace`.

**Result**: ZERO measurable impact. Root cause was upstream — `ProjectWorkspace` itself calls `useWizardForm()` with 4 `useWatch()` subscriptions. Every keystroke triggers ALL 4 watch callbacks → `ProjectWorkspace` re-renders → even though `FormProvider` is scoped and children are memoized, the PARENT re-render invalidates the subtree. The cascade was structural, not a child-subscription issue. **This finding led to Step 10.**

### Step 10: Move Form Subscriptions to WizardLifecycleProvider (DONE — commit `a9c1eb5a`)
**Files changed**: `WizardLifecycleContext.tsx` (new), `ProjectWorkspace.tsx`, `ArchitecturePreviewPane.tsx`, `GovernancePanelWrapper.tsx`, `WizardStepRouter.tsx`, `NewProjectConfirmDialog.tsx`, `useWizardForm.ts`, `useProjectLifecycle.ts`, `useProjectDialogHandlers.ts`, `next.config.mjs`

**10a — New WizardLifecycleContext.tsx**: Context + Provider that owns `useWizardForm()` and `useProjectLifecycle()`. Uses a render prop `children: ({ wizardData }) => ReactNode` to inject `wizardData` into the layout without forcing consumers to subscribe to context directly.

```
ProjectWorkspace (stable — no form subscriptions)
└── WizardLifecycleProvider (owns hooks, re-renders on keystrokes)
    ├── WizardLifecycleContext.Provider (lifecycle callbacks — stable)
    ├── FormProvider (form state — scoped to wizard subtree)
    │   └── WizardStepRouter (consumes context, expected to re-render)
    ├── ArchitecturePreviewPane (receives wizardData prop, React.memo)
    └── GovernancePanelWrapper (receives wizardData prop, React.memo)
```

**10b — ProjectWorkspace is now stable**: No longer calls `useWizardForm()` or `useProjectLifecycle()`. Owns only `useWorkspaceShellUi()` and `useEditorSession()` (both stable on keystroke).

**10c — canvasHash in useWizardForm.ts**: `canvasHash = JSON.stringify(form.getValues(["boundedContexts", "externalContexts", "peerMappings"]))` — only rebuilds `wizardData` when canvas-relevant fields change. Governance field changes (workspaceName, description) do NOT trigger `wizardData` rebuild → `ArchitecturePreviewPane` receives stable reference → `React.memo` bails out.

**10d — Removed contentHash from callback deps**: `useProjectLifecycle.ts` and `useProjectDialogHandlers.ts` use `formRef` pattern — all callbacks have stable deps, no longer invalidated on keystroke.

**10e — Module resolution fix** (commit `9f2c00d8`): Resolved `WizardLifecycleContext` import path errors across 5 consumer files. Used relative paths only — no webpack aliases.

**Measured impact** (post-Step 10 profiler, single keystroke):
| Metric | Baseline (Step 1) | Post-Step 9 | Post-Step 10 | Delta |
|--------|-------------------|-------------|--------------|-------|
| Total commits | 14 | 11 | 9 | −5 (−36%) |
| Immediate Priority | 6 | 6 | 2 | −4 (−67%) |
| Max single commit | 26.7ms | 28.2ms | 14.4ms | −12.3ms (−46%) |
| GraphCanvasInner renders | 4 (16.6ms) | — | 0* | −4 (−100%) |
| ArchitecturePreviewPane renders | 4 (10.4ms) | — | 0* | −4 (−100%) |
| Canvas subtree fibers | ~30+ | — | 0* | −30+ (−100%) |

*Canvas commits may still appear in Commit 5's propagation if `React.memo` doesn't bail out (see Step 12 analysis). The canvasHash should prevent `wizardData` identity change, but the profiler trace shows `ArchitecturePreviewPane` re-rendering inside Commit 5 — indicating `React.memo` is NOT bailing out despite the render prop.

### Step 11: Eliminate PanelResizeHandle Noise + Isolate PanelGroup (DONE)
**Files changed**: `WizardLifecycleContext.tsx`, `ProjectWorkspace.tsx`, `ArchitecturePreviewPane.tsx`, `GovernancePanelWrapper.tsx`, `VerticalResizeHandle.tsx`, `PanelHeader.tsx`, `CollapsedStrip.tsx`, `DesktopLayout.tsx`, `ResizableLayout.tsx`

**Root cause investigation**: The 7 `PanelResizeHandle` commits were NOT caused by `autoSaveId` localStorage writes or resize handle re-renders from props. The actual cascade was a **context boundary inversion**: `FormProvider` (highly volatile, driven by keystrokes) was wrapping the entire layout tree including `PanelGroup` (heavy, should be stable). When `FormProvider` re-rendered, it forced `ProjectWorkspaceLayout` → `ResizableLayout` → `DesktopLayout` → `PanelGroup` → `PanelResizeHandle` to re-render. `React.memo` on `ProjectWorkspaceLayout` failed because `ui`, `editor`, and other hook-return props changed reference identity.

**Key insight**: `React.memo` on layout components can't bail out when props include hook-return objects (`useWorkspaceShellUi`, `useEditorSession`) that may change reference. And even if props were stable, `FormProvider` context changes bypass `React.memo` — all components inside `FormProvider` that subscribe to form context re-render regardless.

**11a — Context boundary inversion (primary fix)**: Removed `FormProvider` from `WizardLifecycleProvider`. Instead, created a `WizardFormMethodsContext` that holds the stable `form` object reference. Exported a `WizardStepFormProvider` that reads `form` from this context and wraps its children with `FormProvider`. This `WizardStepFormProvider` is used ONLY around `<WizardStepRouter>` in the left panel of `ResizableLayout`. Form state cascades are now confined to the wizard panel — the layout tree (`PanelGroup`) is completely outside `FormProvider` scope.

```
ProjectWorkspace (stable — no form subscriptions)
└── WizardLifecycleProvider (owns hooks, re-renders on keystrokes)
    ├── WizardLifecycleContext.Provider (lifecycle callbacks)
    ├── WizardDataContext.Provider (wizardData)
    ├── WizardFormMethodsContext.Provider (form object — stable ref)
    └── ProjectWorkspaceLayout (React.memo, custom areEqual)
        └── ResizableLayout (React.memo)
            └── DesktopLayout (React.memo)
                └── PanelGroup (STABLE — no FormProvider cascade)
                    ├── Panel → WizardStepFormProvider → FormProvider → WizardStepRouter
                    ├── Panel → ArchitecturePreviewPane (reads WizardDataContext)
                    └── Panel → GovernancePanelWrapper (reads WizardDataContext)
```

**11b — Replace render prop with WizardDataContext**: Changed `WizardLifecycleProvider` from render prop to plain `children`. `ArchitecturePreviewPane` and `GovernancePanelWrapper` consume `useWizardData()` directly instead of receiving `wizardData` as a prop.

**11c — Custom `areEqual` on ProjectWorkspaceLayout's React.memo**: `ProjectWorkspaceLayout` receives `ui` and `editor` hook-return objects as props, which may change reference. Custom comparator only checks primitive/stable props (`currentStepIndex`, `viewMode`, `onViewModeChange`, etc.), ignoring `ui`/`editor`/`navigateWithConfirm`/`pendingRoute`/`router` — these are read by children via JSX, not by `ProjectWorkspaceLayout` itself.

**11d — React.memo on layout components**: `VerticalResizeHandle`, `PanelHeader`, `CollapsedStrip`, `DesktopLayout`, `ResizableLayout`.

**Measured impact** (post-Step 11.2 profiler, single keystroke):
| Metric | Baseline (Step 1) | Post-Step 10 | Post-Step 11.2 | Delta |
|--------|-------------------|--------------|----------------|-------|
| Total commits | 14 | 9 | 13 | +4 (environmental noise) |
| Immediate Priority | 6 | 2 | 4 | +2 (3 are redundant routing syncs) |
| Max single commit | 26.7ms | 14.4ms | 8.2ms | −6.2ms (−43%) |
| PanelGroup in render tree | Yes | Yes | **NO** | **ELIMINATED** |
| ArchitecturePreviewPane renders | 4 | 1 | 0 | −4 (−100%) |
| GovernancePanelWrapper renders | 1 | 1 | 0 | −1 (−100%) |
| Canvas subtree fibers | ~30+ | 0 | 0 | Eliminated |

**Profiler analysis**: The 9 `PanelResizeHandle` User-Blocking commits are NOT form-state cascades. They are native DOM pointer events (mouse hover, `onPointerEnter`) captured during the profiling window — they occur hundreds of ms before/after the keystroke and only touch the resize handle components. The context boundary held firm: `ProjectWorkspaceLayout` and `PanelGroup` are **completely absent** from Commit #5's render tree.

The only remaining optimization target is Commit #5 itself (8.2ms): `TemplateSelector` (4.3ms) re-renders unnecessarily when only `IdentityFields` changed. This is Step 12.

### Step 12: Leaf-Node useController in WorkspaceGovernanceStep (PLANNED)
**Problem**: Commit #5 (8.2ms) re-renders the entire `WorkspaceGovernanceStep` including `TemplateSelector` (4.3ms) when only `IdentityFields`/`LabeledInput` changed (a single keystroke in `workspaceName`). The step-level `useFormContext` subscription forces all sibling sections to re-render.

**Root cause**: `WorkspaceGovernanceStep` calls `useFormContext<ProjectConfig>()` which subscribes to the entire form context. When any field changes, the entire step re-renders — including sections that don't depend on the changed field.

**Status after Step 11**: The context boundary is solid. `PanelGroup`, `ArchitecturePreviewPane`, and `GovernancePanelWrapper` are completely outside the form cascade. The remaining optimization is purely about reducing the cost of Commit #5 itself.

**Files involved**:
- `apps/web/features/project-wizard/steps/WorkspaceGovernanceStep.tsx` — uses `useFormContext()` at step level
- `apps/web/features/project-wizard/steps/IdentityFields.tsx` (if exists) — needs `useController` at leaf
- `apps/web/features/project-wizard/steps/TemplateSelector.tsx` — re-renders unnecessarily (4.3ms)
- Other step files (`BoundedContextStep.tsx`, `PeerContextMappingStep.tsx`, `PortConfigurationStep.tsx`, `SummaryStep.tsx`) — all use `useFormContext()` at step level

**Approach**:
1. Replace `useFormContext()` + `watch()`/`setValue()` at step level with `useController()` at individual input level
2. Wrap each section (IdentityFields, TemplateSelector, NamingConventionsFieldset) in `React.memo`
3. Only the `LabeledInput` that changed re-renders — siblings stay stable

**Expected impact**: Commit #5 drops from 8.2ms to < 3ms. TemplateSelector no longer re-renders on governance keystrokes.

## Validation Targets

### Post-Step 11 Actuals (2026-05-10 profiler, single keystroke)

| Metric | Baseline (Step 1) | Post-Step 11.2 | Target |
|--------|-------------------|----------------|--------|
| Total commits | 14 | 13 (4 necessary + 9 noise) | ≤ 2 |
| Immediate Priority | 6 | 4 (1 necessary + 3 redundant) | ≤ 1 |
| Max single commit | 26.7ms | 8.2ms | < 3ms |
| PanelGroup in render tree | Yes | **NO** | NO |
| ArchitecturePreviewPane renders | 4 | 0 | 0 |
| Resize handle cascades | 0 (noise) | 0 (form cascade) | 0 |
| GovernanceAssistantPanel renders | 1 | 0 (outside FormProvider) | 0 on canvas keystroke |

### Post-Step 12 Target (single keystroke)

| Metric | Target | Rationale |
|--------|--------|-----------|
| Max single commit | < 3ms | Only IdentityFields LabeledInput re-renders |
| TemplateSelector renders | 0 | useController at leaf, not useFormContext at step level |
| PanelGroup renders | 0 | Confirmed — context boundary holds |

### Scenario B (node drag) — unchanged targets
- NodeWrapper re-renders per drag: **1** (was all 12)
- EdgeWrapper re-renders per drag: **0** (was all 6)
- Total fiber self-duration: **< 10ms** (was 34.30ms)

### Scenario C (streaming) — unchanged targets
- Commits/second: **≤ 10** (was 31.2)
- Non-governance re-renders: **0** (was 422 for Context.Provider)
- Total governance self-time: **< 500ms** (was 2,024.6ms)

## File Reference Key
> See audit §H4/H5 and blast radius map §3 `useProjectLifecycle.ts:198-204` for dep-array analysis.
> See audit §H1/H2 and blast radius map §3 for Cloud Connection callback details.
> See audit §H12 and blast radius map §2 for SummaryStep watch() hot spot.