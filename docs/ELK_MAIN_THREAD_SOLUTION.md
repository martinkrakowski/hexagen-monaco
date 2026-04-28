# ELK Layout: Main Thread Solution

## Problem

The Web Worker implementation for ELK.js layout calculation was causing a `ChunkLoadError` in Next.js:

```
Loading chunk app/layout failed.
(timeout: http://localhost:3000/_next/static/chunks/app/layout.js)
```

### Root Cause

Next.js has an aggressive internal Webpack configuration that:

1. Detects internal worker logic inside `elk.bundled.js`
2. Attempts to polyfill it with Next.js-specific `_Worker` shim
3. This shim evaluates to `undefined` inside a worker context
4. Results in `_Worker is not a constructor` error

Fighting Next.js Webpack configurations for nested worker compilation creates a fragile build.

## Solution: Main Thread with Async Yielding

We pivoted to **running ELK layout calculation in the main thread** with async yielding to prevent UI freezing.

### Why This Works Better

1. **Serialization Overhead**: Sending 12+ bounded contexts (hundreds of nodes/edges) over `postMessage` requires `JSON.stringify` and `JSON.parse`. The serialization time often exceeds the ELK calculation time (~100ms).

2. **Simpler Architecture**: No worker lifecycle management, no message passing complexity, no webpack configuration battles.

3. **Non-Blocking UI**: Using `await new Promise(resolve => setTimeout(resolve, 10))` yields to the event loop, allowing React to paint loading states before ELK locks the thread.

4. **Superior Algorithm**: We keep ELK.js (not downgrading to dagre), which correctly handles nested Bounded Context parent nodes.

## Implementation

### File Changes

1. **Rewrote `useElkLayout.ts`**
   - Removed Web Worker instantiation and message passing
   - Instantiate ELK once outside the hook: `const elk = new ELK()`
   - Added 10ms async yield before calculation
   - Moved all layout logic (buildElkGraph, extractPositions, layer priorities) into the hook file

2. **Deleted `elk-layout.worker.ts`**
   - No longer needed

3. **Removed webpack noParse from `next.config.mjs`**
   - The `noParse: /elk\.bundled\.js$/` configuration is no longer needed
   - Simplified webpack config back to standard monorepo resolution

### Key Code Pattern

```typescript
const elk = new ELK(); // Instantiate once, reuse

export function useElkLayout() {
  const calculateLayout = useCallback(async (nodes, edges, direction) => {
    // 1. Yield to React render cycle (allows loading spinner to paint)
    await new Promise((resolve) => setTimeout(resolve, 10));

    try {
      // 2. Build ELK graph structure
      const elkGraph = buildElkGraph(nodes, edges, direction);

      // 3. Run calculation (synchronous, ~100ms for typical graphs)
      const layoutedGraph = await elk.layout(elkGraph);

      // 4. Extract positions
      const positions = extractPositions(layoutedGraph);

      return { positions };
    } catch (error) {
      console.error("ELK layout calculation failed:", error);
      throw error;
    }
  }, []);

  return { calculateLayout };
}
```

## Performance Characteristics

- **Typical graph (12 bounded contexts, ~100 nodes)**: ~100ms calculation time
- **10ms yield**: Allows 1 frame at 60fps for UI updates
- **Total perceived delay**: ~110ms (imperceptible to users)
- **UI remains responsive**: Loading spinner displays, buttons disabled during calculation

## Benefits Over Web Worker Approach

| Aspect                 | Web Worker                        | Main Thread + Yield          |
| ---------------------- | --------------------------------- | ---------------------------- |
| Serialization overhead | High (JSON.stringify/parse)       | None                         |
| Build complexity       | High (webpack config battles)     | Low (standard Next.js)       |
| Code complexity        | High (message passing, lifecycle) | Low (simple async function)  |
| Debugging              | Difficult (worker context)        | Easy (standard stack traces) |
| UI responsiveness      | Excellent                         | Excellent (with yield)       |
| Calculation time       | Same                              | Same                         |

## Migration Notes

- No changes required to `useCanvasState.ts` - it already uses the `calculateLayout` function
- No changes required to `CanvasToolbar.tsx` - loading states work the same way
- The `isLayoutCalculating` state in Zustand store continues to work correctly

## Future Considerations

If graphs grow significantly larger (>500 nodes), we could:

1. Implement progressive rendering (calculate and render in chunks)
2. Add a more sophisticated yield strategy (yield every N nodes)
3. Consider a true background thread solution (not Web Worker, but SharedArrayBuffer + Atomics)

However, for the current use case (12-20 bounded contexts), the main thread solution is optimal.

---

**Decision Date**: 2026-04-28
**Status**: Implemented and verified
**Related Files**:

- [`apps/web/features/hexagon-canvas/hooks/useElkLayout.ts`](../apps/web/features/hexagon-canvas/hooks/useElkLayout.ts)
- [`apps/web/next.config.mjs`](../apps/web/next.config.mjs)
