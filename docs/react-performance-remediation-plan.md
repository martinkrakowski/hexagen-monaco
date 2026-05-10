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
| 5 | Fix useProjectLifecycle form dependencies | **Done** | pending commit |
| 6 | Apply Tabs context useMemo | **Closed — no context** | N/A |
| 7 | Split LocalLLMProvider context (streaming isolation) | **Done** | — |
| 8 | Add selector to useCanvasGraphStore + identity-preserving FlowNode mapping | **Done** | — |

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

### Step 5: useProjectLifecycle Form Dependencies (DONE — pending commit)
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

## Validation Targets
After each fix, re-run specified scenario and verify:

**Scenario A (wizard keystroke)**:
- Total commits: **≤ 2** (was 14)
- Canvas commits (GraphCanvasInner): **0** (was 4)
- Total render time: **< 15ms** (was 47.9ms)
- Changed callback props on fiber#250: **0** (was 6 changing props)

**Scenario B (node drag)**:
- NodeWrapper re-renders per drag: **1** (was all 12)
- EdgeWrapper re-renders per drag: **0** (was all 6)
- Total fiber self-duration: **< 10ms** (was 34.30ms)

**Scenario C (streaming)**:
- Commits/second: **≤ 10** (was 31.2)
- Non-governance re-renders: **0** (was 422 for Context.Provider)
- Total governance self-time: **< 500ms** (was 2,024.6ms)

## File Reference Key
> See audit §H4/H5 and blast radius map §3 `useProjectLifecycle.ts:198-204` for dep-array analysis.
> See audit §H1/H2 and blast radius map §3 for Cloud Connection callback details.
> See audit §H12 and blast radius map §2 for SummaryStep watch() hot spot.