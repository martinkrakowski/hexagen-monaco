# React Performance Audit Report — hexagen-monaco

**Date:** 2026-05-09
**Scope:** All `.tsx`/`.ts` files across `apps/web/` and `packages/ui/`
**Files Analyzed:** ~150 React components, 46 hooks, 12 UI primitives
**Auditor:** Principal Frontend Architecture Engineer
**Revision:** v1.3 — marks C1 and H20 as fixed; updates remediation table status

---

## Methodological Caveats

This audit is **static analysis only**. No React DevTools Profiler flamegraphs, Interaction to Next Paint measurements, or render-count baselines were captured. This matters because:

- A violation on a cold render path has **zero user impact** regardless of its theoretical severity.
- Violation density (168 in ~150 files) suggests the criteria may be over-broad and that **false positives exist**.
- Severity ratings below are *predictive* — they must be validated with profiler data before committing to remediation.

**Required validation before remediation:** Run React DevTools Profiler with "Record why each component rendered" enabled on the three hot-path scenarios described in §Validation Protocol. Cross-reference the top 20 most-frequently-re-rendering components against this report's findings before treating any finding as confirmed.

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Violations** | **168** |
| **HIGH** | **21** |
| **MEDIUM** | **75** |
| **LOW** | **72** |

### Distribution by Anti-Pattern Category

| Category | Count | HIGH | MEDIUM | LOW |
|----------|-------|------|--------|-----|
| **1. Unstable `useCallback` Dependencies** | 29 | 7 | 18 | 4 |
| **2. Invalidated `useMemo` Object Dependencies** | 5 | 1 | 4 | 0 |
| **3. Inline Object/Array Instantiation** | 20 | 4 | 10 | 6 |
| **4. Unstable Callback Props** | 39 | 5 | 26 | 8 |
| **5. Unmemoized Leaf Components** | 68 | 0 | 20 | 48 |
| **6. Unmemoized Derived State** | 19 | 2 | 12 | 5 |
| **7. Correctness: Side Effects in `setState` Updater** | 1 | 2 | 0 | 0 |

> **Note:** Category 7 is a new addition from review feedback. Two correctness violations were found that the original audit missed. These are the most critical findings despite not fitting the original 6 anti-pattern categories.

### Severity Recalibrations (from review)

| Finding | Original Rating | Revised Rating | Rationale |
|---------|-----------------|----------------|-----------|
| H21–H23 `React.memo` on UI primitives | HIGH | **LOW** | `React.memo` adds a shallow-equality check on every parent render. For primitive-prop leaf components, React's existing VDOM reconciliation (same element type, same props) is often cheaper than the memo comparison. Without profiler evidence that `Button`/`Badge`/`Icon` are actual bottlenecks, this is cargo-cult optimization. |
| H11 `ThemeContext` inline value | HIGH | **LOW** | Theme changes are user-triggered toggle events (infrequent). Cost of all theme consumers re-rendering once per toggle is negligible. |
| H9 `useCanvasState` `nodePositions` dependency | HIGH | **HIGH** ✓ | Confirmed: position updates during drag are high-frequency events that could trigger graph reload cycles. |
| H4/H5 `ui`/`editor` cascade | HIGH | **HIGH** ✓ | Confirmed: this is the largest callback cascade in the app. |
| H24 `computeDiff` in render | HIGH | **HIGH** ✓ | Confirmed: Set/Map/Sort computation on every render is genuinely expensive. |
| H11 `Tabs` context inline value | HIGH | **MEDIUM** | `setActiveTab` is a `useState` setter (stable identity per React's contract). Only `activeTab` (a primitive) changes. The issue is the inline object wrapper, which forces re-renders on every parent render even when `activeTab` is unchanged. If parent re-renders are frequent, this amplifies cost; otherwise, tab switches are infrequent. |

### Root Cause Analysis

The audit reveals **three systemic root causes** driving the majority of violations:

1. **Unmemoized hook return objects** — Hooks like `useWorkspaceShellUi`, `useEditorSession`, `useCloudConnection`, `useCanvasState`, `useCloudConnectivity`, and `useSavedProjects` return inline object literals on every render. These cascade instability through the entire component tree, invalidating every `useCallback` downstream that depends on them.

2. **Pervasive `watch()` usage in react-hook-form steps** — Every wizard step calls `watch()` which returns new object/array references on every form field update. This causes the step component and all children to re-render on every keystroke, defeating any callback stabilization or `React.memo` boundaries.

3. **Widespread absence of `React.memo` on leaf/presentational components** — 68 pure presentational components lack `React.memo`. However, many of these are in stable render contexts where the cost is negligible. Only those in high-frequency update paths (canvas drag, streaming, wizard keystroke) are genuinely impactful.

---

## HIGH-Severity Violations

### Correctness Violations (Category 7 — New)

These are the most critical findings. They violate React's contract and can produce real bugs, not just performance waste.

| # | File | Line | Root Cause |
|---|------|------|------------|
| C1 | `useNodeModification.ts` | `submitPendingChanges` | **FIXED (da1bff74).** Added `pendingChangesRef` following existing `transactionIdRef` pattern; extracted `startStreaming()` outside `setState` updater. Sub-agent's `useCallback` fixes for `onPipelineComplete`/`onPipelineError` and `transactionIdRef` kept. |
| C2 | `useCanvasState.ts` | `loadGraph` effect | **`wizardData` removed from effect dependency array and replaced with `wizardDataRef`.** Using a ref to avoid a dependency is only safe if the effect does not need to re-run when that value changes. `wizardData` was the trigger for graph regeneration — nothing in the remaining dep array (`projectId`, `layoutLoaded`, `manifestHash`) changes when the user edits wizard content. The graph will go stale after wizard edits until some unrelated state change. **Correct pattern:** Keep `wizardData` in the effect deps but ensure stable identity at source. **Prerequisite:** This fix depends on the `watch()` decomposition in Architectural Recommendation 4. If `buildWizardData` in `useWizardForm` depends on `watch()` output (identified as the #2 systemic root cause), then `useMemo(() => buildWizardData(), [buildWizardData])` will break on every keystroke because `watch()` returns a new reference, making `buildWizardData` unstable. C2 cannot be implemented in isolation — Rec 4 must be applied first so `wizardData` has a stable identity at its source. |

### Category 1: Unstable `useCallback` Dependencies

| # | File | Line | Root Cause |
|---|------|------|------------|
| H1 | `GovernanceAssistantPanel.tsx` | 99-118 | `handleCloudConnect`/`handleDisconnect`/`handleRetry` depend on `cloudConnection` — a new object from `useCloudConnection()` every render |
| H2 | `CloudModelSettingsView.tsx` | 46, 58-109 | `useEffect` and `handleConnect` depend on `connectivity` — a new object from `useCloudConnectivity()` every render |
| H3 | `ExportContext.tsx` | 73-135 | `exportZip`/`requestGithubExport`/`submitGithubExport` depend on entire `activeWorkspace` object |
| H4 | `useProjectLifecycle.ts` | 114-217 | 5 callbacks depend on `ui` object — unmemoized return from `useWorkspaceShellUi` |
| H5 | `useProjectLifecycle.ts` | 104-217 | `form` object as dependency; `editor` object as dependency — both unstable |
| H6 | `useProjectGenerationFlow.ts` | 99 | `execute` depends on entire `options` object |
| H7 | `useNodeModification.ts` | 44-63 | Inline arrow callbacks passed to `useModificationStreaming` destabilize `startStreaming` |
| H8 | `useArchitectureModification.ts` | 55-77 | Same pattern — inline `onPipelineComplete`/`onPipelineError` to `usePipelineStreaming` |
| H9 | `useCanvasState.ts` | 89-103 | `nodePositions` as dependency triggers graph reload on every position update |
| H10 | `useSavedProjects.ts` | 88-93 | `loadProject` depends on `projects` array — changes on every mutation |

### Category 2: Invalidated `useMemo` Object Dependencies

| # | File | Line | Root Cause |
|---|------|------|------------|
| H12 | `SummaryStep.tsx` | 65-67 | `watch("governance")` returns new object identity on every form change |

### Category 3: Inline Object/Array Instantiation

| # | File | Line | Root Cause |
|---|------|------|------------|
| H13 | `useWorkspaceShellUi.ts` | 64-77 | Return object not wrapped in `useMemo` — root cause of H4/H5 cascade |
| H14 | `useEditorSession.ts` | 59-70 | Return object not wrapped in `useMemo` — root cause of H5 `editor` cascade |

### Category 4: Unstable Callback Props

| # | File | Line | Root Cause |
|---|------|------|------------|
| H15 | `QuestionsSection.tsx` | 44 | `onToggle={() => onQuestionClick(q)}` inside `.map()` — defeats `React.memo` on `QuestionAccordion`. Compounded by nested inline in `FollowUpTag` at line 85. |
| H16 | `PortConfigurationStep.tsx` | 81-86 | 2 inline arrows per `ContextPortCard` inside `.map()` — toggling one port re-creates callbacks for ALL context cards |
| H17 | `ContextList.tsx` | 60-63 | 3 inline arrows per `ContextCard` inside `.map()` |
| H18 | `MappingList.tsx` | 90-93 | 3 inline arrows per `MappingCard` inside `.map()` |
| H19 | `GovernanceAssistantPanel.tsx` | 231 | `onSendMessage` inline arrow flows through ModeWrapper → CloudModeView → CloudChatView → CloudChatInterface (deep chain) |

### Category 6: Unmemoized Derived State

| # | File | Line | Root Cause |
|---|------|------|------------|
| H20 | `ManifestDiffView.tsx` | 105-107 | **FIXED.** Wrapped `computeDiff()` in `useMemo([current, proposed])` and both `.filter()` calls in `useMemo([diff])`. Eliminates Set/Map/Sort computation on every render. |
| H21 | `MappingForm.tsx` | 36-39 | `contextOptions = boundedContexts.map(...)` creates new array + new inner objects on every render |

---

## MEDIUM-Severity Violations (Highlights)

### Hooks / Context Layer (21 violations)

| # | File | Root Cause |
|---|------|------------|
| M0 | `Tabs.tsx:50` | Inline context value `{ activeTab, setActiveTab }` forces all tab consumers to re-render on every parent render. `setActiveTab` is a `useState` setter (stable identity), so only `activeTab` (a primitive) actually changes — but the inline wrapper object creates a new reference on every parent render even when `activeTab` is unchanged. Amplified when parent re-renders frequently (e.g., `useWorkspaceShellUi` cascade). |
| M1 | `useStepNavigation.ts:12-28` | `searchParams` unstable dependency in 3 `useCallback` hooks |
| M2 | `usePanelToggle.ts:11-28` | Same `searchParams` instability |
| M3 | `useStorageQuota.ts:47-51` | Return object spread creates new identity every render |
| M4 | `useStorageQuota.ts:45` | `getLruSavedProjectIds()` called in render body |
| M5 | `useSavedProjects.ts:155-167` | Early-return stub object with inline arrow functions |
| M6 | `useSavedProjectsOverlay.ts:49-57` | Return object not wrapped in `useMemo` |
| M7 | `useCanvasHistory.ts:18-28` | `temporalState` from `getState()` — new snapshot every render |
| M8 | `useCanvasValidation.ts:13-36` | `nodes` array dependency recreated on every drag |
| M9 | `useCanvasState.ts:321-387` | `nodes`/`edges` arrays as dependencies in 4 core canvas callbacks |
| M10 | `use-canvas-viewport-manager.ts:38` | `state` object (unmemoized return) as `useEffect` dependency |
| M11 | `useCloudLLM.ts:194` | `sendMessage` depends on `state.messages` — changes every streaming chunk |
| M12 | `useCloudConnection.ts:195-204` | Return object not wrapped in `useMemo` |
| M13 | `useCloudConnectivity.ts:18-27` | `getState()` creates new object on every render |
| M14 | `useGovernanceThread.ts:222-236` | `setConversationThread` not wrapped in `useCallback` |
| M15 | `useArchitectureModification.ts:173,236` | `state.result` object dependency |
| M16 | `useNodeModification.ts:135` | `state.pendingChanges` array dependency — see C1 for the related correctness bug |
| M17 | `useSettingsValidation.ts:79-81` | `state.errors` object dependency |
| M18 | `useProjectGeneration.ts:83,129` | `wizardData` object + `loading` boolean as dependencies |
| M19 | `useArchitectureDownload.ts:38` | `wizardData` object dependency |
| M20 | `useGenerateWithAiForm.ts:31-53` | `setValue`/`reset` not `useCallback`; return object not `useMemo` |

### Governance-Assistant Components (18 violations)

Key patterns: inline callbacks in `QuestionsSection`/`ViolationsSection`/`SuggestionsSection` `.map()` loops, spread objects creating new references (`entryWithQuestion`), `getClientProviders()` in render body, `visibleMessages` filter in render body, missing `React.memo` on `ModelProgressCard`/`ProgressSection`/`ViolationItem`/`SuggestionItem`/`ThreadEntry`/`FollowUpTag`/`CloudChatInterface`, `getCardStatus()` returning new discriminated-union objects per card per render.

### Project-Wizard Components (25 violations)

Key patterns: `watch()` returning new object/array references on every form update, inline arrows to `IdentityFields`/`TemplateSelector`/`ContextList`/`MappingList`, `|| []` fallback arrays, `ContextPortCard` creating `portConfig` fallback object inline, `OUTBOUND_PORTS.filter()` in render body, `totalPorts` `.reduce()` in render body, missing `React.memo` on 18+ presentational components.

### @hexagen/ui Package (7 violations)

Key patterns: `useDisclosure` callbacks depend on `onOpen`/`onClose` (consumer may pass inline), `useDialog`/`useRovingTabIndex` return objects not `useMemo`-wrapped, `ViewToggle` default icon props create new React elements per render, `Checkbox.onChange` inline arrow.

---

## LOW-Severity Violations (72 total)

Includes 48 leaf components lacking `React.memo` that render in stable contexts, plus the following recalibrated findings:

| # | File | Original | Revised | Rationale |
|---|------|----------|---------|-----------|
| L1 | `Button.tsx` (`@hexagen/ui`) | HIGH | LOW | `React.memo` adds shallow-equality check on every parent render. Without profiler evidence, this is speculative. Measure first. |
| L2 | `Badge.tsx` (`@hexagen/ui`) | HIGH | LOW | Same rationale as L1. |
| L3 | `Icon.tsx` (`@hexagen/ui`) | HIGH | LOW | Same rationale as L1. |
| L4 | `useTheme.tsx` context value | HIGH | LOW | Theme changes are user-triggered toggle events (infrequent). Cost negligible. |

Remaining 68 LOW findings are unchanged from v1.0: leaf components in stable contexts, minor array allocations, static callback allocations, and style object instantiations.

---

## Top 10 Remediation Actions (Ordered by Re-Render Reduction Impact)

| Priority | Action | Fixes | Impact | Prerequisite |
|----------|--------|-------|--------|--------------|
| **P0-C** | **Fix C1:** ✅ Done — `pendingChangesRef` + `startStreaming()` outside updater (da1bff74) | C1 | Prevents double-invocation in StrictMode; correctness fix, not perf | Done |
| **P0-C** | **Fix C2:** Restore `wizardData` to `loadGraph` effect deps; ensure stable identity at source. | C2 | Prevents stale graph after wizard edits | **Blocked by Rec 4 (`watch()` decomposition).** `buildWizardData` in `useWizardForm` depends on `watch()` output, which returns a new reference per keystroke. Without decomposing `watch()` first, memoizing `wizardData` upstream will not produce a stable identity. Rec 4 is the prerequisite. |
| **P0** | Wrap `useWorkspaceShellUi` return in `useMemo` + destructure `ui`/`form`/`editor` into specific methods in `useProjectLifecycle` deps | H4, H5, H13, H14 | Stabilizes 5+ callbacks, eliminates the largest callback cascade in the app | Validate with Profiler Scenario A |
| **P0** | Wrap `useCloudConnection` + `useCloudConnectivity` return objects in `useMemo` | H1, H2, M12, M13 | Stabilizes 6 callbacks + 1 effect in governance-assistant | Validate with Profiler Scenario B |
| **P0** | Memoize `Tabs` context value with `useMemo` | H11 | Stabilizes all tab trigger/content consumers | None |
| **P0** | **Wrap `computeDiff()` in `useMemo([current, proposed])` in `ManifestDiffView`** | H20 | Eliminates Set/Map/Sort computation on every render | ✅ Done |
| **P1** | Use `useRef` for `onPipelineComplete`/`onPipelineError` in `useNodeModification` + `useArchitectureModification` | H7, H8 | Stabilizes streaming callback chain | None |
| **P1** | Destructure `activeWorkspace` into primitives in `ExportContext` callbacks | H3 | Stabilizes 3 export callbacks | None |
| **P1** | Wrap `GovernanceAssistantPanel` inline callbacks in `useCallback` | H19 | Stabilizes deep ModeWrapper chain | Validate with Profiler Scenario B |
| **P2** | Replace `[...].filter(Boolean).join(" ")` className patterns in `@hexagen/ui` with `cn()` | 7 LOW | Correctness (Tailwind merge) + eliminates per-render array allocation | None |

> **Note:** `React.memo` on `@hexagen/ui` primitives (formerly H21–H23) is intentionally removed from the P0 list. Adding `React.memo` without profiler evidence that these components are bottlenecks is premature. If Profiler Scenario A or B shows them in the top 20 most-frequently-re-rendering components, promote to P1.

---

## Architectural Recommendations

### 1. Hook Return Value Discipline (Conditional Fix)

**Problem:** 12+ custom hooks return inline object literals, creating new references on every render. This is the #1 source of cascading instability.

**Mandate (revised from v1.1):** Hooks whose return value is **used as a `useEffect` dependency**, **passed as a prop to a `React.memo` child**, or **has any field destructured at the call site and used as a `useCallback`/`useEffect` dependency** must stabilize their return identity with `useMemo`. Hooks called once per component and individually destructured by consumers need not — the `useMemo` adds allocation overhead without measurable benefit.

```tsx
// MUST stabilize (used as useEffect dep or React.memo prop)
return useMemo(() => ({
  state, connect, retry, disconnect
}), [state, connect, retry, disconnect]);

// MUST also stabilize (fields destructured and used as downstream deps)
// const { retry } = useCloudConnection();
// const handleRetry = useCallback(() => retry(), [retry]); // retry must be stable
return useMemo(() => ({
  connect, disconnect, retry, clearError
}), [connect, disconnect, retry, clearError]);

// Need NOT stabilize (fields individually destructured by consumer but NOT used as deps)
return { status, isLoading, error };
```

### 2. Callback Deps: Destructure Primitives, Use Refs for Mutable Reads

**Problem:** Entire object references (`activeWorkspace`, `ui`, `form`, `cloudConnection`) used as `useCallback` dependencies.

**Mandate:**
- If the callback only reads specific primitive fields, destructure them: `[activeWorkspace.projectId]` instead of `[activeWorkspace]`
- If the callback needs current-but-not-reactive values, use `useRef` pattern:

```tsx
const workspaceRef = useRef(activeWorkspace);
workspaceRef.current = activeWorkspace;
const exportZip = useCallback(async () => {
  const ws = workspaceRef.current;
  // ...
}, []);
```

**Constraint:** Ref-escaping a dependency is only safe when the effect/callback does not need to re-run when that value changes. If the value is a *trigger* (like `wizardData` for graph regeneration), it must remain in the dep array. Fix the identity upstream instead.

### 3. `.map()` Callback Factories

**Problem:** 15+ components create inline arrow functions inside `.map()` loops, defeating child `React.memo`.

**Mandate:** Use curried memoized handlers or stable callback dictionaries:

```tsx
// Before
{items.map(item => (
  <Child key={item.id} onClick={() => handleClick(item.id)} />
))}

// After
const handleClick = useCallback((id: string) => { ... }, [deps]);
// Then in Child: <Child onClick={handleClick} itemId={item.id} />
// Child calls: props.onClick(props.itemId)
```

### 4. `watch()` Decomposition

**Problem:** `watch("boundedContexts")` and `watch("governance")` return new object/array references on every form update, causing the entire step subtree to re-render.

**Mandate:**
- Use `useWatch({ name: "boundedContexts" })` from react-hook-form for subscription-based re-renders — but note its limitation: `useWatch` still returns a new array reference on every change to any field within `boundedContexts`. This eliminates unnecessary re-renders in *sibling* components that don't subscribe, but does **not** solve identity instability within the subscribing component itself. If that component passes the whole array as a prop or uses it as a `useCallback`/`useEffect` dependency, the instability persists.
- For genuine identity stability within the subscribing component, use field-level subscriptions: `watch("boundedContexts.0.name")` — each returns a primitive that is referentially stable when unchanged.
- Or move `watch()` / `useWatch()` calls into leaf components that render a single field, so intermediate components never hold the unstable array reference.

### 5. `React.memo` Baseline (Conditional)

**Problem:** 68 presentational components lack `React.memo`.

**Mandate (revised from v1.0):**
- Apply `React.memo` to components **confirmed by profiler** to re-render frequently without prop changes
- Components in high-frequency update paths (canvas drag, streaming, wizard keystroke) are strong candidates
- For components receiving object props, add custom `areEqual` comparators
- Do **not** blanket-apply `React.memo` to all leaf components — the shallow-equality check has a non-zero cost on every parent render

### 6. Correctness as a Constraint

**Problem:** The original audit optimized solely for referential equality and missed a side effect inside a `setState` updater, plus a stale-closure regression introduced by ref-escaping a reactive dependency.

**Mandate:** Any remediation that moves logic into or out of `setState` updaters, `useEffect` callbacks, or `useCallback` closures must be checked for:
1. **Updater purity** — `setState((prev) => { ... })` must not fire network requests, schedule timeouts, or mutate external state.
2. **Effect reactivity** — Replacing a `useEffect` dep with a ref read is only valid if the effect must not re-run when that value changes. If the value is a trigger, keep it in deps and fix identity upstream.
3. **Callback staleness** — `useCallback` with `[]` deps that closes over a frequently-changing value will read stale data. Use `useRef` to capture the latest value *only if* the callback is invoked on user action (not during render).

---

## Validation Protocol

Before committing to remediation, run the following profiler baselines. Each takes <10 minutes and either confirms or eliminates a P0 finding.

### Step 1: Establish Baselines

Run React DevTools Profiler on three interaction scenarios:

| Scenario | Interaction | Targets | Expected Findings |
|----------|-------------|---------|-------------------|
| **A — Wizard keystroke** | Single keypress in any wizard text field | H3, H4, H5, H12, M-series watch() violations | Count re-rendered components; measure combined render duration |
| **B — Streaming chunk** | 5 seconds of active governance assistant streaming | H1, H2, H7, H8, M11 | Count re-render depth per chunk; measure commit bar spikes |
| **C — Canvas drag** | Single node drag gesture | H9, M8, M9 | Verify only `onNodeDragStop` fires expensive commit; continuous drag renders indicate instability |

Export the profiler JSON for each scenario. This is the baseline to diff against after remediation.

### Step 2: Triage with "Why Did This Render"

Enable **"Record why each component rendered"** in DevTools Profiler settings. Re-run the three scenarios. Cross-reference the top 20 most-frequently-re-rendering components against the audit's HIGH findings. If `Button` or `Badge` do not appear in the top 20 during Scenario A or B, deprioritize those findings.

### Step 3: Validate the Cascade Claims

Add a temporary `console.count('useWorkspaceShellUi render')` inside `useWorkspaceShellUi`. Type a single character in a wizard field. If the count increments more than once per keystroke, the H4/H5 cascade is confirmed. Do the same for `useCloudConnection` during a streaming session.

### Step 4: Fix One P0 Item, Measure, Repeat

Do not batch remediations. Fix one item, re-run the relevant profiler scenario, compare commit bars to baseline. If improvement is measurable, commit and proceed. If not, the finding was a false positive — skip it.

### Step 5: Automate Regression Prevention

**`why-did-you-render` in development** — configure it on the 3–4 components the profiler identified as most expensive. It logs when a component re-renders due to referential inequality on structurally identical props.

**Render-count test for the streaming path** — using `@testing-library/react`, simulate 10 streaming state updates and assert that governance panel children rendered no more than N times. Encode the performance contract.

### Playwright Performance Gates

The Playwright tests below serve as **CI regression gates** — they complement but do not replace the profiler validation in Steps 1–4 above. The profiler tells you *why* a component re-rendered; Playwright tells you *whether* the total re-render count exceeds a contract. Use both:

1. **Profiler (Steps 1–4):** Run manually before each P0 remediation. Establishes baseline, confirms root cause, validates fix.
2. **Playwright (below):** Runs in CI on every merge to main. Catches regressions in the performance contract.

For CI regression detection, use Playwright to measure **outcomes** (frame drops, long tasks, interaction latency) — but not React render counts directly. Bridge the gap by instrumenting the app in test builds:

```tsx
// instrumentation.tsx (dev/test builds only — do not ship in production)
import { Profiler, type ReactNode } from "react";

const renderCounts = new Map<string, number>();

if (typeof window !== "undefined" && process.env.NODE_ENV === "test") {
  (window as any).__RENDER_COUNTS__ = renderCounts;
}

export function TrackedComponent({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <Profiler
      id={id}
      onRender={() => {
        renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
      }}
    >
      {children}
    </Profiler>
  );
}

// Usage — wrap flagged components at their mount point:
// <TrackedComponent id="GovernanceAssistantPanel">
//   <GovernanceAssistantPanel {...props} />
// </TrackedComponent>
```

```ts
// Playwright test: streaming renders proportionally to chunks
// THRESHOLD METHODOLOGY:
// 1. Run this test against the UNOPTIMIZED build → record actual count (e.g., 42)
// 2. Apply the P0 remediations → run again → record optimized count (e.g., 11)
// 3. Set the CI threshold to (optimized_count + tolerance), e.g., 14
//    This asserts the fix HOLDS, not merely that things are slightly better than broken.
//    Setting threshold to unoptimized_count * 0.8 (e.g., 34) would let a half-fixed
//    codebase pass, defeating the purpose.
// The placeholder value below (14) must be replaced with your measured optimized + 3.
test("streaming does not re-render GovernanceAssistantPanel excessively", async ({ page }) => {
  await page.goto("/workspace");
  await page.evaluate(() => (window as any).__RENDER_COUNTS__.clear());
  await page.click("[data-testid='send-message']");
  await page.waitForSelector("[data-testid='stream-complete']");
  const panelRenders = await page.evaluate(() =>
    (window as any).__RENDER_COUNTS__.get("GovernanceAssistantPanel") ?? 0
  );
  // Replace 14 with (measured_optimized_count + 3) after post-fix baseline run
  expect(panelRenders).toBeLessThan(14);
});
```

Run perf tests as a separate Playwright project so they do not gate every PR:

```ts
// playwright.config.ts
projects: [
  { name: "functional", testMatch: "**/*.spec.ts" },
  { name: "performance", testMatch: "**/*.perf.ts", retries: 2 },
]
```

**Do not use Lighthouse or Web Vitals for this class of problem.** These are interaction-path re-renders, not initial load issues. React DevTools Profiler and `why-did-you-render` are the correct instruments.

---

## Correctness Reference: The `setState` Updater Contract

For anyone implementing remediations, here is the explicit pattern for C1 (**now fixed — da1bff74**):

```tsx
// ❌ WRONG: Side effect inside updater
setState((prev) => {
  const changes = prev.pendingChanges;
  if (changes.length === 0) return prev;
  startStreaming(buildIntent(changes)); // fires network request inside updater
  return { ...prev, status: "streaming" };
});

// ✅ CORRECT: Read via ref, transition state, fire side effect outside
const submitPendingChanges = useCallback(
  (nodes: HexagonNode[]) => {
    const changes = stateRef.current.pendingChanges;
    if (changes.length === 0) return;
    const intent = buildIntentFromChanges(changes, nodes);
    setState((prev) => ({
      ...prev,
      status: "streaming",
      transactionId: null,
      patches: [],
      error: null,
    }));
    startStreaming(intent); // side effect outside updater
  },
  [startStreaming],
);
```

For C2 (the `wizardData` ref-escape pattern):

```tsx
// ❌ WRONG: Ref-escaping a trigger dependency
const wizardDataRef = useRef(wizardData);
wizardDataRef.current = wizardData;
useEffect(() => {
  loadGraph(wizardDataRef.current);
}, [projectId, layoutLoaded, manifestHash]); // wizardData changes won't trigger this

// ✅ CORRECT: Keep wizardData in deps, ensure stable identity at source
// PREREQUISITE: Apply Rec 4 (watch() decomposition) first.
// If useWizardForm's buildWizardData depends on watch(), it must be
// decomposed so that buildWizardData has stable output identity.
//
// In useWizardForm (after Rec 4 is applied):
const buildWizardData = useCallback(() => { ... }, [/* granular field deps, not watch() */]);
const wizardData = useMemo(() => buildWizardData(), [buildWizardData]);

// In useCanvasState:
useEffect(() => {
  loadGraph(wizardData);
}, [wizardData, projectId, layoutLoaded, manifestHash]); // now re-runs when wizardData changes
```

---

*End of report v1.2.*
