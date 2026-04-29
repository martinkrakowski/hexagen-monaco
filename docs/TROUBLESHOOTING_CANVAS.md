# Canvas Visualization Troubleshooting Guide

## Recent Changes

We implemented a complete rebuild of the canvas visualization system with the following changes:

### Files Modified

1. **`apps/web/features/hexagon-canvas/hooks/useElkLayout.ts`** - Worker instantiation with `new URL(..., import.meta.url)`
2. **`apps/web/features/hexagon-canvas/hooks/useCanvasState.ts`** - Enhanced state management with Zustand + ELK worker
3. **`apps/web/features/hexagon-canvas/CanvasToolbar.tsx`** - Enhanced toolbar with undo/redo/cleanup buttons
4. **`apps/web/features/hexagon-canvas/GraphCanvasWrapper.tsx`** - Complete integration with viewport orchestration
5. **`apps/web/next.config.mjs`** - Added `noParse` for elk.bundled.js

### New Files Created

1. **`apps/web/features/hexagon-canvas/stores/useCanvasGraphStore.ts`** - Zustand store with temporal middleware
2. **`apps/web/features/hexagon-canvas/hooks/useCanvasHistory.ts`** - Undo/redo interface
3. **`apps/web/app/workers/elk-layout.worker.ts`** - ELK layout calculation worker

## Common Issues

### Issue 1: Visualizer Not Loading

**Symptoms:**

- Canvas area is blank or stuck on loader
- No graph nodes visible

**Possible Causes:**

1. Worker initialization failure
2. ELK layout calculation error
3. Missing dependencies

**Debug Steps:**

```javascript
// Check browser console for errors
// Look for:
// - Worker initialization errors
// - ELK layout errors
// - Import/module resolution errors
```

### Issue 2: AI Governance Panel Stuck on Loader

**Symptoms:**

- Governance panel shows initial loader indefinitely
- No response from AI

**Possible Causes:**

1. Unrelated to canvas changes - check webllm.worker.ts
2. IndexedDB initialization issue
3. Model loading failure

**Debug Steps:**

```javascript
// Check browser console for:
// - WebLLM initialization errors
// - IndexedDB errors
// - Model download/loading errors
```

### Issue 3: Worker Errors

**Symptoms:**

- Console shows `_Worker is not a constructor`
- Console shows `Cannot find module` errors

**Possible Causes:**

1. Webpack not compiling worker as separate chunk
2. Path resolution issues
3. noParse not working

**Debug Steps:**

1. Check DevTools → Sources → Page for worker chunk
2. Should see: `_next/static/chunks/[hash].worker.js`
3. Should NOT see worker code in `app-pages-browser` chunks

**Fix:**

```bash
# Clear Next.js cache and rebuild
rm -rf apps/web/.next
yarn build
```

## Rollback Instructions

If the new implementation is causing issues, you can rollback:

### Quick Rollback (Revert Worker Changes Only)

```typescript
// apps/web/features/hexagon-canvas/hooks/useElkLayout.ts
// Change back to:
workerRef.current = new Worker(
  new URL("@/workers/elk-layout.worker.ts", import.meta.url),
  { type: "module" },
);
```

### Full Rollback (Restore Old Implementation)

The old implementation files were removed. To restore:

1. Check git history for previous versions
2. Restore these files:
   - Old `useCanvasLayout.ts` (if it had the old logic)
   - Old `CanvasToolbar.tsx`
   - Old `GraphCanvasWrapper.tsx`

```bash
# View git history
git log --oneline --all -- apps/web/features/hexagon-canvas/

# Restore specific file from commit
git show <commit-hash>:apps/web/features/hexagon-canvas/hooks/useCanvasLayout.ts > useCanvasLayout.ts.backup
```

## Verification Checklist

After any changes, verify:

- [ ] `yarn build` completes successfully
- [ ] `yarn typecheck` passes
- [ ] `yarn lint` passes
- [ ] Browser console shows no errors
- [ ] Canvas visualizer loads and displays nodes
- [ ] AI Governance panel initializes
- [ ] Undo/Redo buttons are visible
- [ ] Clean-up button works

## Getting Help

If issues persist:

1. **Collect Information:**
   - Browser console errors (full stack traces)
   - Network tab (check for failed worker loads)
   - DevTools → Sources (verify worker chunk exists)

2. **Check Dependencies:**

   ```bash
   yarn why elkjs
   yarn why zustand
   yarn why zundo
   ```

3. **Verify File Structure:**

   ```bash
   ls -la apps/web/features/hexagon-canvas/hooks/
   ls -la apps/web/app/workers/
   ```

4. **Test in Isolation:**
   - Try loading just the canvas page: `/architecture-viewer`
   - Try loading just the governance panel
   - Identify which component is failing

## Known Working Configuration

**Dependencies:**

- elkjs: ^0.11.1
- zustand: (already installed)
- zundo: ^2.3.0
- @xyflow/react: (already installed)

**Build Output:**

- Should see separate worker chunk in build output
- No webpack errors about Worker constructor
- No module resolution errors

**Runtime:**

- Worker initializes without errors
- ELK layout calculation completes
- Canvas renders nodes and edges
- Undo/redo functionality works
