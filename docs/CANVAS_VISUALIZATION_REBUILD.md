# Canvas Visualization Rebuild - Implementation Progress

## Overview

This document tracks the implementation of a comprehensive rebuild of the HexaGen Monaco architecture visualization engine to solve the "ball of yarn" problem in complex DDD architectures with 12+ bounded contexts.

## Problem Statement

The current visualization suffers from:

- Overlapping bounded contexts (Context #7 overlapping Context #1)
- No hierarchical boundaries respected
- Basic layout algorithms failing with highly interconnected graphs
- UI freezing during layout calculation
- No undo/redo for manual adjustments
- Poor reconciliation when manifest changes

## Solution Architecture

### Phase 1: State Architecture & Time Travel ✅ COMPLETED

**Goal:** Separate structural state from ephemeral UI state and provide undo/redo capabilities.

**Implemented:**

1. ✅ **Dependencies Installed** (`zustand@5.0.12`, `zundo@2.3.0`, `elkjs@0.11.1`)
2. ✅ **Zustand Store** ([`useCanvasGraphStore.ts`](../apps/web/features/hexagon-canvas/stores/useCanvasGraphStore.ts))
   - Tracks `nodes`, `edges`, `manifestHash`, `isLayoutCalculating`
   - Excludes ephemeral state from history
   - Records snapshots only on `setGraph`, `updateNodePositions`, `reset`
   - Maintains 50-state history limit
3. ✅ **Undo/Redo Hook** ([`useCanvasHistory.ts`](../apps/web/features/hexagon-canvas/hooks/useCanvasHistory.ts))
   - Clean interface to temporal operations
   - Provides `undo()`, `redo()`, `clear()`, `canUndo`, `canRedo`

**Key Design Decisions:**

- Only record history on `onNodeDragStop`, not during drag (prevents memory bloat)
- Equality check excludes `isLayoutCalculating` (ephemeral UI state)
- `manifestHash` tracked to detect configuration drift

---

### Phase 2: Deterministic Layout Engine & Sub-graph Grouping ✅ COMPLETED

**Goal:** Replace basic layout with ELK.js hierarchical engine.

**Implemented:**

1. ✅ **ELK.js Main Thread with Async Yielding** ([`useElkLayout.ts`](../apps/web/features/hexagon-canvas/hooks/useElkLayout.ts))
   - Runs ELK calculation in main thread with 10ms async yield
   - Hierarchical layout with parent/child node support
   - Layered hexagonal directives:
     - Layer 0: Primary Adapters (west/north)
     - Layer 1: Primary Ports
     - Layer 2: Domain (entities, use-cases, bounded contexts)
     - Layer 3: Secondary Ports
     - Layer 4: Secondary Adapters (east/south)
   - Configurable direction (`RIGHT`, `DOWN`, `LEFT`, `UP`)
   - Recursive position extraction for nested nodes

2. ✅ **Integration** ([`useCanvasState.ts`](../apps/web/features/hexagon-canvas/hooks/useCanvasState.ts))
   - Integrated into canvas state management
   - Loading states during calculation
   - Manifest change detection triggers recalculation

**Key Design Decisions:**

- **Main thread over Web Worker**: Next.js webpack conflicts made worker approach fragile
- **Async yielding**: 10ms yield allows React to paint loading states before ~100ms calculation
- **No serialization overhead**: Avoids JSON.stringify/parse of large graphs
- ELK algorithm: `layered` (best for directed graphs)
- Node spacing: 80px between nodes, 100px between layers
- Priority-based layering ensures hexagonal flow

**See:** [`docs/ELK_MAIN_THREAD_SOLUTION.md`](./ELK_MAIN_THREAD_SOLUTION.md) for detailed rationale

---

### Phase 3: Persistence & Smart Reconciliation ⏳ PENDING

**Goal:** Debounced localStorage + intelligent manifest reconciliation.

**Planned:**

1. Debounced persistence (1000ms delay)
2. Reconciliation engine:
   - Match: Apply saved positions
   - Orphaned: Discard
   - New: Run ELK on new nodes only, append to existing graph
3. Manifest hash comparison to detect changes

---

### Phase 4: UI Controls & Viewport Orchestration ✅ COMPLETED

**Goal:** User controls for layout reset and viewport management.

**Implemented:**

1. ✅ **Enhanced Toolbar** ([`CanvasToolbar.tsx`](../apps/web/features/hexagon-canvas/CanvasToolbar.tsx))
   - Undo/Redo buttons with disabled states
   - "Clean-up" button for force recalculation
   - Loading indicator during calculation
   - Proper button states during operations

2. ✅ **Canvas Wrapper** ([`GraphCanvasWrapper.tsx`](../apps/web/features/hexagon-canvas/GraphCanvasWrapper.tsx))
   - Integrated undo/redo with canvas history
   - Viewport orchestration with `fitView()` after operations
   - Smooth transitions (800ms duration, 0.2 padding)
   - Loading states propagated to toolbar

**Key Features:**

- Undo/Redo buttons show enabled/disabled state based on history
- Clean-up button triggers full layout recalculation
- All operations disable buttons during calculation
- Viewport automatically frames content after state changes

---

## File Structure

```
apps/web/
├── features/hexagon-canvas/
│   ├── stores/
│   │   └── useCanvasGraphStore.ts          ✅ Zustand store with temporal
│   ├── hooks/
│   │   ├── useCanvasHistory.ts             ✅ Undo/redo interface
│   │   ├── useElkLayout.ts                 ✅ Main thread ELK with async yield
│   │   ├── useCanvasLayout.ts              ✅ Legacy persistence (Phase 3)
│   │   └── useCanvasState.ts               ✅ Integrated state management
│   ├── CanvasToolbar.tsx                   ✅ Enhanced toolbar with controls
│   ├── GraphCanvasWrapper.tsx              ✅ Complete integration
│   └── ...
└── docs/
    ├── CANVAS_VISUALIZATION_REBUILD.md     ✅ This file
    └── ELK_MAIN_THREAD_SOLUTION.md         ✅ Technical rationale
```

---

## Next Steps

1. **Integrate ELK into `useCanvasState`**
   - Replace dagre with ELK worker
   - Add loading state management
   - Handle worker errors gracefully

2. **Implement Bounded Context Grouping**
   - Generate parent nodes for each bounded context
   - Assign `parentId` to all internal elements
   - Configure ELK to layout contexts internally first

3. **Build Reconciliation Engine**
   - Compare manifest hash on import
   - Diff node IDs (match/orphaned/new)
   - Intelligent positioning for new nodes

4. **Add UI Controls**
   - Clean-up button in `CanvasToolbar`
   - Undo/redo buttons
   - Loading overlay during calculation

---

## Testing Strategy

1. **Unit Tests:**
   - Store actions (setNodes, updateNodePosition, etc.)
   - Temporal operations (undo/redo)
   - Worker message handling

2. **Integration Tests:**
   - Full layout calculation flow
   - Reconciliation with manifest changes
   - Persistence and restoration

3. **E2E Tests:**
   - User drags nodes → positions saved
   - User clicks undo → positions restored
   - User imports new manifest → new nodes positioned correctly
   - User clicks clean-up → layout recalculated

---

## Performance Targets

- Layout calculation: <2s for 12 bounded contexts (100+ nodes)
- Undo/redo: <100ms (instant feel)
- Persistence write: Debounced to 1s (no UI impact)
- Worker overhead: <50ms (negligible)

---

## Dependencies

| Package         | Version | Purpose                         |
| --------------- | ------- | ------------------------------- |
| `zustand`       | 5.0.12  | State management                |
| `zundo`         | 2.3.0   | Temporal middleware (undo/redo) |
| `elkjs`         | 0.11.1  | Hierarchical graph layout       |
| `@xyflow/react` | 12.10.1 | React Flow (existing)           |

---

## References

- [ELK.js Documentation](https://eclipse.dev/elk/)
- [Zundo Documentation](https://github.com/charkour/zundo)
- [React Flow Documentation](https://reactflow.dev/)
- Original Task Specification: See task description

---

**Last Updated:** 2026-04-28
**Status:** Phase 2 In Progress (60% complete)
