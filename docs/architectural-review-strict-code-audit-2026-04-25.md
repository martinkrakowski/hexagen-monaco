# Strict Structural Code Review — Remediation Audit

**Report Date:** 2026-04-25  
**Audit Scope:** Batches 1.4–1.6 remediation deliverables  
**Review Mode:** Adversarial — assume violation until proven otherwise  
**Status:** Phase 0 (✅ Complete) + Phase 1 (⚠️ Partial) + Phase 2 (❌ Not Started)

---

## Executive Summary

The remediation work has **successfully completed Phase 0** (boundary enforcement) but **Phase 1 is only structurally complete, not behaviorally implemented**. The canvas feature still performs semantic compilation inside React components and has never wired the newly created projection compiler infrastructure.

**Critical findings:**

- 5 violations prevent semantic compilation from moving out of React
- `MapNodeVisualPort` interface is dead code—never invoked
- Canvas code still duplicates category classification logic
- Phase 2 work (moving canvas compilation out of React) cannot proceed until these violations are fixed

---

## CRITICAL VIOLATIONS

### **[CRITICAL-V1] Loose String Arguments to Projection Compiler**

**Files Affected:** `apps/web/features/hexagon-canvas/lib/generate-bounded-context-nodes.ts`

**Locations:** Lines 85, 104, 132, 160, 238

**Current Code:**

```typescript
// Line 85
category: "Domain",

// Line 104
category: "Use Cases",

// Line 132
category: "Entity",

// Line 160
category: "Use Case",

// Line 238 — Semantic computation in canvas layer
category: classifyAdapterLabel(adapter.label, adapter.side),
```

**Violation:**
The `MapNodeVisualPort.map()` interface was designed to accept only `NodeVisualSpec` (containing kind, label, nodeId). Instead:

- Categories are hardcoded as loose string literals instead of being computed by the projection compiler
- Semantic classification logic (`classifyAdapterLabel`) executes in the canvas layer, not in the projection compiler
- The interface completely bypasses the abstraction boundary that was just created in Phase 1

**Why It Breaks the Architecture:**

- Remediation Report §Phase 1 specifies: "Remove `label: ""` and similar placeholder outputs from the compiler path"
- Instead, the canvas feature **creates** the label and category before the compiler ever sees the node
- The entire purpose of `DefaultNodeVisualMapperAdapter.resolveCategory()` is subverted

**Required Fix:**

```typescript
// Phase 1 intended behavior:
const spec: NodeVisualSpec = {
  nodeId: entityId,
  kind: NodeKind.Entity, // Type-safe enum
  label: name,
  // No category — let projection compiler derive it
};

// Canvas MUST delegate to projection compiler (but currently doesn't)
const projection = mapNodeVisualUseCase.execute(spec);
category: projection.category; // Compiler-computed
```

**Remediation Status:** ❌ **NOT FIXED** — Phase 1 infrastructure created but never used.

---

### **[CRITICAL-V2] Semantic Compilation Inside React Component**

**File:** `apps/web/features/hexagon-canvas/BoundedContext.tsx`

**Locations:** Lines 67-82 (resolveVariantForNodeType), 84-91 (getPortCategoryStyle), 254, 263

**Current Code:**

```typescript
// Lines 67-82 — Domain logic executed inside React
function resolveVariantForNodeType(nodeType: HexagonNodeType): VisualVariant {
  const category: VisualVariantCategory =
    nodeType === "entity"
      ? "entity"
      : nodeType === "port"
        ? "port"
        : nodeType === "use-case"
          ? "use-case"
          : "adapter";
  return variantResolver.resolve(category); // ← Semantic compilation
}

// Lines 84-91 — More semantic compilation
function getPortCategoryStyle(
  category: string | undefined,
): VisualVariant | null {
  if (!category) return null;
  const key = category.toLowerCase();
  if (!isKnownCategory(key)) return null;
  return variantResolver.resolve(key); // ← Semantic compilation
}

// Line 254 — Called during render
const styles = resolveVariantForNodeType(nodeType);

// Line 263 — Called during render
const categoryStyle = getPortCategoryStyle(data.category);
```

**Violation:**

- **DESIGN.md §3.1:** "Components are **presentation-only**. They receive typed props and render UI. Nothing else."
- **DESIGN.md §3.4:** All `@hexagen/ui` component props must extend `NoSemanticState<T>`, which explicitly forbids semantic state work in components
- These functions duplicate the exact logic in `DefaultNodeVisualMapperAdapter.resolveCategory()`
- Semantic compilation should happen **outside** React, before component receives data
- The Remediation Report §Phase 2 explicitly calls this out: "Move projection compilation out of React"

**Why It Breaks the Architecture:**

- Violates the core principle that React is presentation-only
- Creates circular redundancy: canvas layer creates nodes with categories, React re-derives them
- Makes the projection compiler infrastructure pointless—it's never used

**Required Fix:**

```typescript
// BoundedContext should be pure presentation:
import type { NoSemanticState } from "@hexagen/ui/types";

interface BoundedContextProps extends NoSemanticState<SVGProps<SVGGElement>> {
  variant: VisualVariant;  // Pre-computed by application layer
  label: string;
  // No semantic logic, no category, no nodeType
}

export function BoundedContext({
  variant,
  label,
  ...props
}: BoundedContextProps) {
  return (
    <g {...props}>
      <rect fill={variant.bgColor} />
      <text>{label}</text>
    </g>
  );
}

// Application layer must compute variant BEFORE passing to component:
const nodeVisualProjection = mapNodeVisualUseCase.execute(spec);
<BoundedContext
  variant={nodeVisualProjection.variant}
  label={nodeVisualProjection.label}
  {...otherProps}
/>
```

**Remediation Status:** ❌ **NOT FIXED** — Still performing semantic work in React.

---

### **[CRITICAL-V3] Dead Port / Dependency Inversion Failure**

**Files Affected:**

- `apps/web/features/hexagon-canvas/BoundedContext.tsx` (Lines 12, 44)
- `apps/web/features/hexagon-canvas/lib/generate-bounded-context-nodes.ts` (Lines 9, 238)

**Current Code:**

```typescript
// BoundedContext.tsx Line 12 — Direct import of adapter (WRONG)
import { CvaVariantResolverAdapter } from "@hexagen/ui-projection-compiler";

// BoundedContext.tsx Line 44 — Composition root in presentation layer (WRONG)
const variantResolver = new CvaVariantResolverAdapter();

// generate-bounded-context-nodes.ts Line 9
import { classifyAdapterLabel } from "./classify-adapter-label";

// generate-bounded-context-nodes.ts Line 238 — Direct use of canvas-layer function
category: classifyAdapterLabel(adapter.label, adapter.side),
```

**Violation:**

- Canvas imports concrete adapter implementation instead of depending on `MapNodeVisualPort` interface
- Composition root (dependency wiring) is in presentation layer instead of application boundary layer
- **The `MapNodeVisualPort` interface exists but has NO CALLERS in the entire canvas feature**
- This proves Phase 1 work is structurally sound but behaviorally unused (dead code)

**Why It Breaks the Architecture:**

- Violates hexagonal architecture principle: implementations should never be imported directly in feature layers
- Creates coupling to concrete adapter instead of abstract port
- The entire inversion-of-control chain is broken: port → use case → adapter is never wired

**Required Fix:**

```typescript
// Application boundary (e.g., in ArchitectureGraphAdapter or new CanvasInitializerService):
const resolveVariantPort = new CvaVariantResolverAdapter();
const mapNodeVisualPort = new DefaultNodeVisualMapperAdapter(resolveVariantPort);
const mapNodeVisualUseCase = new MapNodeVisualUseCase(mapNodeVisualPort);

// Inject into canvas via dependency injection:
<GraphCanvasWrapper
  mapNodeVisualUseCase={mapNodeVisualUseCase}
  wizardData={wizardData}
/>

// Canvas feature uses it (not creates it):
export function useCanvasState(
  wizardData: WizardData,
  mapNodeVisualUseCase: MapNodeVisualUseCase  // ← Injected dependency
): UseCanvasStateResult {
  const { nodes, edges } = generateHexagonalContextMap(wizardData);

  // Delegate semantic compilation to use case
  const projections = nodes.map(node =>
    mapNodeVisualUseCase.execute({
      nodeId: node.id,
      kind: node.kind,
      label: node.label,
    })
  );

  return {
    nodes: projections.map(p => ({
      id: p.nodeId,
      label: p.label,
      variant: p.variant,  // From compiler, not from React
    })),
    // ...
  };
}
```

**Remediation Status:** ❌ **NOT WIRED** — Port interface created but never used.

---

### **[CRITICAL-V4] Hardcoded Category Literals Bypass Type Safety**

**File:** `apps/web/features/hexagon-canvas/lib/generate-bounded-context-nodes.ts`

**Locations:** Lines 85, 104, 132, 160

**Current Code:**

```typescript
category: "Domain",      // No enum, no validation
category: "Use Cases",   // No enum, no validation
category: "Entity",      // No enum, no validation
category: "Use Case",    // No enum, no validation
```

**Violation:**

- String literals have zero compile-time validation against `VisualVariantCategory`
- `NodeVisualSpec.category?` is optional and should be **computed by projection compiler**, not hardcoded by canvas
- No type alignment: canvas uses `HexagonNodeType` ("entity", "port") but core domain uses `NodeKind` (Enum)
- Duplicates the exact category resolution logic that should execute once in the projection compiler

**Why It Breaks the Architecture:**

- Creates multiple sources of truth for category→variant mapping
- If someone needs to add a new category, they must change canvas code AND projection compiler
- Type system provides zero validation that string literals match expected categories

**Required Fix:**

```typescript
// Don't hardcode categories; let projection compiler compute them based on kind
const specs: NodeVisualSpec[] = boundedContexts.map((bc) => ({
  nodeId: bc.id,
  kind: NodeKind.Entity, // Type-safe enum from core-domain
  label: bc.name,
  // Omit category — projection compiler will derive it from kind
}));

const projections = specs.map((spec) => mapNodeVisualUseCase.execute(spec));
// projections[i].category is now type-safe VisualVariantCategory
```

**Remediation Status:** ❌ **NOT FIXED** — Still using hardcoded strings.

---

### **[CRITICAL-V5] Incomplete NodeVisualSpec Adoption**

**File:** `apps/web/features/hexagon-canvas/lib/generate-bounded-context-nodes.ts`

**Locations:** Multiple lines throughout node creation

**Current Code:**

```typescript
// Canvas creates nodes with { type, category } structure
nodes.push({
  id: entityId,
  label: name,
  type: "entity" as HexagonNodeType, // ← HexagonNodeType (canvas enum)
  category: "Entity", // ← Hardcoded string
  position: { x: posX, y: posY },
});

// But NodeVisualSpec defines different structure:
export interface NodeVisualSpec {
  nodeId: Identifier;
  kind: NodeKind; // ← NodeKind (core-domain enum) — DIFFERENT!
  label: string;
  category?: string; // ← Optional, should be computed
}
```

**Violation:**

- Two incompatible type systems coexist: `HexagonNodeType` (canvas) vs `NodeKind` (core-domain)
- `NodeVisualSpec` was never instantiated in the canvas generation layer
- The `MapNodeVisualPort` interface exists but is structurally orphaned (no callers)
- Phase 1 work is **structurally complete but behaviorally dead**

**Why It Breaks the Architecture:**

- Prevents the entire projection compiler pipeline from being used
- Canvas generates nodes directly instead of via the intended data transformation pipeline
- The compiler infrastructure exists but serves no purpose

**Required Fix:**

```typescript
// Step 1: Create NodeVisualSpec with NodeKind enum
const specs: NodeVisualSpec[] = nodes.map((node) => ({
  nodeId: node.id,
  kind: mapHexagonTypeToNodeKind(node.type), // Convert canvas type → core-domain kind
  label: node.label,
}));

// Step 2: Batch compile via use case
const projections = specs.map((spec) => mapNodeVisualUseCase.execute(spec));

// Step 3: Create HexagonNode with pre-computed variant
const compiledNodes = projections.map((projection) => ({
  id: projection.nodeId,
  label: projection.label,
  type: mapVariantToHexagonType(projection.variant), // Reverse mapping for UI
  variant: projection.variant, // Carry pre-computed variant
  category: projection.category, // Type-safe, compiler-computed
  position: computePosition(projection.nodeId),
}));
```

**Remediation Status:** ⚠️ **Partially Complete** — Interface defined but never used in actual flow.

---

## HIGH-SEVERITY FINDINGS

### **[HIGH-V6] Stale Semantic Classification Helper**

**File:** `apps/web/features/hexagon-canvas/lib/classify-adapter-label.ts`

**Status:** This file should not exist. It contains semantic domain logic (`classifyAdapterLabel()`) that belongs in the projection compiler, not in the canvas feature layer.

**Current Location (Wrong):** `apps/web/features/hexagon-canvas/lib/classify-adapter-label.ts`

**Should Be (Right):** Logic integrated into `packages/ui-projection-compiler/src/infrastructure/adapters/default-node-visual-mapper.adapter.ts:33-78` (already exists there)

**Why It's a Problem:**

- Canvas feature owns semantic classification, which violates separation of concerns
- Duplicates logic already in projection compiler
- Creates two places to update if classification rules change

**Required Fix:** Delete the file. The logic in `DefaultNodeVisualMapperAdapter.resolveCategory()` is the authoritative implementation.

---

## VERIFICATION: CLEAN FINDINGS ✅

### Demo/Fallback Behavior — **COMPLIANT**

- ✅ No `projectId === "demo"` patterns found
- ✅ `ArchitecturePreviewPane` removed `projectId="demo"` from GraphCanvasWrapper call
- ✅ `useCanvasState` now requires `wizardData` and throws explicit error when missing
- ✅ No DEMO_DATA constants in canvas feature

### Source-Level Import Bypasses — **COMPLIANT**

- ✅ No `@hexagen/ui/src/` imports found bypassing barrel exports
- ✅ No `packages/*/src` imports in app code
- ✅ `tsconfig.base.json` correctly uses path aliases pointing to `src/index.ts` for dev-time resolution
- ✅ Next.js webpack config includes `conditionNames: ["source", ...]` for runtime resolution

### Phase 0 Boundary Enforcement — **FULLY COMPLIANT**

- ✅ webpack configuration has no `@hexagen/* → packages/*/src` aliasing
- ✅ All workspace dependencies declared in `apps/web/package.json` (15/15 packages)
- ✅ Package-level tsconfigs have empty `paths` (no source aliasing at package level)
- ✅ Architecture linter includes all 28 bounded contexts (verified via tsconfig.base.json references)
- ✅ `yarn lint:arch` passes

---

## SUMMARY: EASIEST WAYS TO BREAK THE ARCHITECTURE

1. **Add new adapter classification** → Just hardcode it in `classifyAdapterLabel()` in canvas (projection compiler never invoked)
2. **Change category→variant mapping** → Must edit in 3+ places: `classify-adapter-label.ts`, `BoundedContext.tsx` variants, `DefaultNodeVisualMapperAdapter.ts` (no single source of truth)
3. **Render semantic variants without compiler** → Already happening; `variantResolver.resolve()` called directly in React component
4. **Bypass the entire projection compiler** → Already bypassed; `MapNodeVisualPort` has zero callers
5. **Restore demo/fallback behavior** → Would require editing `useCanvasState` hook only (enforcement exists but wasn't needed)

---

## ARCHITECTURAL STATE DIAGRAM

### Current State (Broken) ❌

```
Canvas Feature
  ├─ generate-bounded-context-nodes.ts
  │  └─ Creates HexagonNode { type: string, category: string }
  │     └─ Calls classifyAdapterLabel() for categories (SEMANTIC LOGIC IN CANVAS)
  │
  └─ BoundedContext.tsx (React Component)
     ├─ Imports CvaVariantResolverAdapter directly (WRONG DEPENDENCY)
     ├─ Calls resolveVariantForNodeType() (SEMANTIC COMPILATION IN REACT)
     └─ Calls getPortCategoryStyle() (MORE SEMANTIC COMPILATION IN REACT)

Projection Compiler (Dead Code)
  ├─ MapNodeVisualPort (Interface) — NOT WIRED
  ├─ MapNodeVisualUseCase — NOT CALLED
  ├─ DefaultNodeVisualMapperAdapter — NOT INSTANTIATED
  └─ CvaVariantResolverAdapter — INSTANTIATED DIRECTLY IN REACT (WRONG)
```

### Intended State (Phase 1-2) ✓

```
Canvas Feature
  └─ generate-hexagonal-context-map.ts
     └─ Creates NodeVisualSpec { nodeId, kind: NodeKind, label }

Application Layer (Composition Root)
  └─ Wire: MapNodeVisualUseCase ← DefaultNodeVisualMapperAdapter ← CvaVariantResolverAdapter

Canvas Feature
  └─ useCanvasState Hook
     └─ Calls: mapNodeVisualUseCase.execute(spec)
        └─ Returns: NodeVisualProjection { nodeId, variant, label, category }

React Component (Presentation Only)
  └─ BoundedContext.tsx
     ├─ Extends NoSemanticState<T> (TYPE-SAFE)
     └─ Receives pre-computed: { variant, label } — NO SEMANTIC LOGIC
```

---

## REMEDIATION STATUS BY PHASE

| Phase       | Task                                 | Acceptance Gates                              | Current Status     |
| ----------- | ------------------------------------ | --------------------------------------------- | ------------------ |
| **Phase 0** | Lock Enforcement                     | ✅ 4/4 gates met                              | **✅ COMPLETE**    |
| **Phase 1** | Complete Published Language          | ⚠️ 2/4 gates met                              | **⚠️ PARTIAL**     |
|             | NodeVisualSpec enrichment            | ✅ kind, label, category added                | ✅ Done            |
|             | Compiler ports redesigned            | ✅ MapNodeVisualPort.map(spec) created        | ✅ Done            |
|             | UI no longer accepts loose strings   | ❌ Canvas still passes hardcoded strings      | ❌ **BROKEN**      |
|             | Projection compiler actually invoked | ❌ Use case never called in canvas            | ❌ **BROKEN**      |
| **Phase 2** | Move Canvas Compilation              | ❌ 0/4 gates met                              | **❌ NOT STARTED** |
|             | Semantic graph generation moved      | ❌ Still in canvas/lib files                  | ❌ **BLOCKED**     |
|             | BoundedContext presentation-only     | ❌ Still contains resolveVariantForNodeType() | ❌ **BLOCKED**     |
|             | React no longer derives categories   | ❌ getPortCategoryStyle() in component        | ❌ **BLOCKED**     |
|             | Preview renders real data            | ✅ No more demo fallback                      | ✅ Done            |

---

## CRITICAL NEXT STEP

The remediation cannot progress to Phase 2 until the canvas feature is wired to use the projection compiler.

**Required work (blocking Phase 2):**

1. Create application service or adapter boundary that wires the projection compiler
2. Inject `MapNodeVisualUseCase` into `useCanvasState` hook
3. Replace all hardcoded category assignments with `mapNodeVisualUseCase.execute(spec)`
4. Remove semantic compilation functions from `BoundedContext.tsx`
5. Make `BoundedContext.tsx` extend `NoSemanticState<T>` and accept pre-computed `variant`
6. Delete `classify-adapter-label.ts` (logic is redundant with projection compiler)

---

## VERDICT

✅ **Phase 0 is solid and complete** — Boundary enforcement is mechanically enforced.

⚠️ **Phase 1 is structurally half-done** — Infrastructure exists (NodeVisualSpec, ports, use cases) but is never used.

❌ **Phase 2 cannot start** — Canvas still performs semantic compilation inside React. The projection compiler is dead code.

The remediation report's statement holds true: **"The repository needs the declared architecture to become the only executable path."** Phase 1 declared the path but didn't make it the executable path. Canvas still executes the old ad hoc path.
