# Quick Start: Seeing the Undo/Redo Buttons

## The Issue

The undo/redo buttons ARE implemented, but they're in the **V2 components**. Your app is currently using the old `GraphCanvasWrapper` component, which doesn't have these buttons.

## Where the Buttons Are

The undo/redo buttons are fully implemented in:

- **`CanvasToolbarV2.tsx`** - Lines 34-56 (Undo and Redo buttons)
- **`GraphCanvasWrapperV2.tsx`** - Wires them up with the history hook

## How to See Them (2 Options)

### Option 1: Quick Test (Recommended)

Update just the architecture viewer page to test:

**File:** `apps/web/app/architecture-viewer/page.tsx`

```typescript
// BEFORE (current - no undo/redo buttons)
import { GraphCanvasWrapper } from "../../features/hexagon-canvas/GraphCanvasWrapper";

export default function ArchitectureViewerPage() {
  return (
    <div className="h-screen w-full">
      <GraphCanvasWrapper />
    </div>
  );
}
```

```typescript
// AFTER (with undo/redo buttons)
import { GraphCanvasWrapperV2 } from "../../features/hexagon-canvas/GraphCanvasWrapperV2";

export default function ArchitectureViewerPage() {
  return (
    <div className="h-screen w-full">
      <GraphCanvasWrapperV2 />
    </div>
  );
}
```

### Option 2: Full Migration

Update all usages:

**1. Architecture Viewer** (`apps/web/app/architecture-viewer/page.tsx`)

```typescript
- import { GraphCanvasWrapper } from "../../features/hexagon-canvas/GraphCanvasWrapper";
+ import { GraphCanvasWrapperV2 } from "../../features/hexagon-canvas/GraphCanvasWrapperV2";

- <GraphCanvasWrapper />
+ <GraphCanvasWrapperV2 />
```

**2. Architecture Preview Pane** (`apps/web/features/workspace-shell/ArchitecturePreviewPane.tsx`)

```typescript
- import { GraphCanvasWrapper } from "../hexagon-canvas/GraphCanvasWrapper";
+ import { GraphCanvasWrapperV2 } from "../hexagon-canvas/GraphCanvasWrapperV2";

- <GraphCanvasWrapper wizardData={wizardData} />
+ <GraphCanvasWrapperV2 wizardData={wizardData} />
```

## What You'll See

After switching to V2, the toolbar will have:

```
[Add Node] | [Undo] [Redo] | [Clean-up] ............... [Calculating...] [Export]
```

- **Undo button** (↶ icon) - Disabled when no history
- **Redo button** (↷ icon) - Disabled when nothing to redo
- **Clean-up button** (⟳ icon) - Recalculates layout
- **Loading indicator** - Shows "Calculating layout..." during ELK calculation

## Testing the Buttons

1. **Start the app:**

   ```bash
   cd apps/web && yarn dev
   ```

2. **Navigate to:** `http://localhost:3000/architecture-viewer`

3. **Test undo/redo:**
   - Drag a node to a new position
   - Click **Undo** (↶) - node returns to original position
   - Click **Redo** (↷) - node moves back to dragged position

4. **Test clean-up:**
   - Click **Clean-up** (⟳) - recalculates entire layout
   - Watch loading indicator appear
   - Viewport automatically fits after calculation

## Visual Comparison

### Old Toolbar (Current)

```
[Add Node] ............... [Zoom In] [Zoom Out] [Export]
```

### New Toolbar (V2)

```
[Add Node] | [Undo] [Redo] | [Clean-up] ............... [Calculating...] [Export]
```

## Why Two Versions?

I created V2 components alongside the old ones for **safe, gradual migration**:

- ✅ Old components still work (backward compatible)
- ✅ Test V2 without breaking existing functionality
- ✅ Switch back easily if issues arise
- ✅ Remove old components after V2 is proven

## Need Help?

See full documentation:

- [`CANVAS_MIGRATION_GUIDE.md`](./CANVAS_MIGRATION_GUIDE.md) - Complete migration guide
- [`CANVAS_IMPLEMENTATION_SUMMARY.md`](./CANVAS_IMPLEMENTATION_SUMMARY.md) - Technical details
- [`CANVAS_VISUALIZATION_REBUILD.md`](./CANVAS_VISUALIZATION_REBUILD.md) - Implementation progress

---

**TL;DR:** Change `GraphCanvasWrapper` to `GraphCanvasWrapperV2` in your imports to see the undo/redo buttons!
