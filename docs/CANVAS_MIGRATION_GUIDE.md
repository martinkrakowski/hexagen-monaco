# Canvas Visualization Migration Guide

## Overview

This guide explains how to migrate from the old canvas implementation to the new V2 implementation with ELK layout, undo/redo, and improved state management.

---

## What's New in V2

### 1. **Zustand Store with Temporal Middleware**

- Centralized state management for nodes and edges
- Built-in undo/redo with 50-state history
- Intelligent snapshot recording (only on drag stop, not during drag)

### 2. **ELK.js Layout Engine in Web Worker**

- Hierarchical graph layout
- Runs in background thread (no UI freezing)
- Layered hexagonal architecture enforcement
- Deterministic positioning

### 3. **Enhanced UI Controls**

- Undo/Redo buttons
- Clean-up button (recalculate layout)
- Loading states during calculation
- Disabled states when appropriate

### 4. **Viewport Orchestration**

- Automatic `fitView()` after undo/redo
- Smooth transitions (800ms duration)
- Proper padding (0.2)

---

## Migration Steps

### Step 1: Update Imports

**Old:**

```typescript
import { GraphCanvasWrapper } from "@/features/hexagon-canvas";
import { useCanvasState } from "@/features/hexagon-canvas/hooks/useCanvasState";
```

**New:**

```typescript
import { GraphCanvasWrapperV2 } from "@/features/hexagon-canvas/GraphCanvasWrapperV2";
import { useCanvasStateV2 } from "@/features/hexagon-canvas/hooks/useCanvasStateV2";
import { useCanvasHistory } from "@/features/hexagon-canvas/hooks/useCanvasHistory";
```

### Step 2: Update Component Usage

**Old:**

```tsx
<GraphCanvasWrapper projectId={projectId} wizardData={wizardData} />
```

**New:**

```tsx
<GraphCanvasWrapperV2 projectId={projectId} wizardData={wizardData} />
```

The API is identical, but the new version includes:

- Undo/Redo buttons in toolbar
- Clean-up button for layout recalculation
- Loading indicator during layout calculation
- Automatic viewport fitting after state changes

### Step 3: Access Undo/Redo Programmatically (Optional)

If you need to trigger undo/redo from outside the canvas:

```typescript
import { useCanvasHistory } from "@/features/hexagon-canvas/hooks/useCanvasHistory";

function MyComponent() {
  const { undo, redo, canUndo, canRedo } = useCanvasHistory();

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
    </div>
  );
}
```

### Step 4: Access Layout Calculation (Optional)

If you need to trigger layout recalculation programmatically:

```typescript
import { useCanvasStateV2 } from "@/features/hexagon-canvas/hooks/useCanvasStateV2";

function MyComponent() {
  const state = useCanvasStateV2(projectId, wizardData);

  if ("error" in state) {
    return <div>Error: {state.error.message}</div>;
  }

  const handleRecalculate = async () => {
    await state.recalculateLayout();
  };

  return (
    <div>
      <button
        onClick={handleRecalculate}
        disabled={state.isLayoutCalculating}
      >
        Recalculate Layout
      </button>
    </div>
  );
}
```

---

## Breaking Changes

### 1. Return Type Changes

**Old `useCanvasState`:**

```typescript
interface UseCanvasStateResult {
  nodes: HexagonNode[];
  edges: HexagonEdge[];
  viewport: CanvasViewport;
  selectedNodeId?: string;
  onNodeDragStop: (node: HexagonNode) => void;
  onNodeDoubleClick: (node: HexagonNode) => void;
  onAddNode: () => void;
  onExportImage: () => void;
  onUpdateNode: (
    nodeId: string,
    updates: Pick<HexagonNode, "label" | "type">,
  ) => void;
  onCloseEditor: () => void;
  clearCanvasLayout: () => void;
}
```

**New `useCanvasStateV2`:**

```typescript
interface UseCanvasStateResult {
  // ... all old properties, plus:
  isLayoutCalculating: boolean; // NEW
  recalculateLayout: () => Promise<void>; // NEW
}
```

### 2. Layout Algorithm

- **Old:** Uses `dagre` with top-bottom layout
- **New:** Uses `ELK.js` with left-right hexagonal layout

This may result in different node positions. Users can use the "Clean-up" button to recalculate.

### 3. State Management

- **Old:** Local React state
- **New:** Zustand store with temporal middleware

This enables undo/redo but changes how state is managed internally.

---

## Backward Compatibility

The old components are **not removed** and can still be used:

- `GraphCanvasWrapper` (old)
- `useCanvasState` (old)
- `CanvasToolbar` (old)

This allows for gradual migration. Both versions can coexist in the codebase.

---

## Performance Improvements

### Before (Old Implementation)

- Layout calculation blocks UI thread
- No undo/redo (manual positioning lost on refresh)
- Basic dagre layout struggles with 12+ contexts
- No loading states

### After (V2 Implementation)

- Layout calculation in Web Worker (non-blocking)
- 50-state undo/redo history
- ELK hierarchical layout handles complex graphs
- Loading states and disabled buttons during calculation
- Automatic viewport fitting

---

## Testing Checklist

After migration, verify:

- [ ] Graph loads correctly
- [ ] Nodes are positioned properly
- [ ] Drag and drop works
- [ ] Undo button works after dragging nodes
- [ ] Redo button works after undo
- [ ] Clean-up button recalculates layout
- [ ] Loading indicator shows during calculation
- [ ] Viewport fits after undo/redo
- [ ] Export still works
- [ ] Node editor dialog works
- [ ] Add node works

---

## Rollback Plan

If issues arise, simply revert to old components:

```typescript
// Rollback: Change V2 back to old version
import { GraphCanvasWrapper } from "@/features/hexagon-canvas";
// import { GraphCanvasWrapperV2 } from "@/features/hexagon-canvas/GraphCanvasWrapperV2";

<GraphCanvasWrapper projectId={projectId} wizardData={wizardData} />
```

---

## Future Enhancements (Phase 3)

The following features are planned but not yet implemented:

1. **Smart Reconciliation Engine**
   - Detect manifest changes
   - Intelligently position new nodes
   - Preserve manual adjustments when possible

2. **Enhanced Persistence**
   - Debounced localStorage writes
   - Per-project position storage
   - Conflict resolution

3. **Bounded Context Grouping**
   - Visual boundaries around contexts
   - Hierarchical sub-graphs
   - Collapsible contexts

---

## Support

For issues or questions:

1. Check [`docs/CANVAS_VISUALIZATION_REBUILD.md`](./CANVAS_VISUALIZATION_REBUILD.md) for implementation details
2. Review the code in `apps/web/features/hexagon-canvas/`
3. Check existing tests in `apps/web/__tests__/`

---

**Last Updated:** 2026-04-28
**Migration Status:** Ready for testing
