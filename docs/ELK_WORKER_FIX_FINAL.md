# ELK.js Web Worker Fix - Final Solution

## Problem Summary

When using ELK.js for graph layout calculation in a Web Worker, two issues occurred:

1. **Wrong Bundle Target**: Webpack compiled the worker file as part of the main page bundle (`app-pages-browser`) instead of as a separate worker chunk
2. **Worker Constructor Rewriting**: Webpack transformed `new Worker(...)` calls inside `elk.bundled.js` into `__webpack_worker__` references, which don't exist in worker execution context

**Error:** `Uncaught TypeError: _Worker is not a constructor`

## Root Cause Analysis

### Issue 1: Worker Bundling

```typescript
// WRONG - webpack treats this as a static import
const worker = new Worker("/workers/elk-layout.worker.ts");
// Result: Bundled into page chunk, not worker chunk
```

The worker file was being bundled into the main application bundle instead of being compiled as a separate worker chunk with its own runtime.

### Issue 2: Worker Constructor Transformation

When webpack processes `elk.bundled.js`, it finds `new Worker(...)` calls and replaces them with webpack's own worker abstraction (`__webpack_worker__`), which only exists in the page bundle runtime, not in actual Web Worker execution scope.

## Complete Solution

### 1. Fix Worker Instantiation (useElkLayout.ts)

Use webpack 5's `new URL(..., import.meta.url)` pattern to signal that this should be compiled as a separate worker chunk:

```typescript
// apps/web/features/hexagon-canvas/hooks/useElkLayout.ts

// Create worker using relative path for webpack 5 worker compilation
// new URL(..., import.meta.url) signals webpack to compile as separate worker chunk
workerRef.current = new Worker(
  new URL("../../../app/workers/elk-layout.worker.ts", import.meta.url),
  { type: "module" },
);
```

**Key Points:**

- Must use **relative path**, not path alias (`@/workers/...`)
- The `new URL(..., import.meta.url)` pattern is webpack 5's signal for worker compilation
- Results in a separate worker chunk: `_next/static/chunks/[hash].worker.js`

### 2. Prevent ELK Transformation (next.config.mjs)

Add `noParse` configuration to prevent webpack from transforming `elk.bundled.js`:

```javascript
// apps/web/next.config.mjs

webpack: (config, { isServer }) => {
  // ... existing config ...

  if (!isServer) {
    // Prevent webpack from parsing elk.bundled.js
    // It contains `new Worker(...)` that webpack rewrites into __webpack_worker__,
    // which doesn't exist when the file runs inside our own Web Worker.
    // noParse tells webpack to include the file as-is, unchanged.
    const existing = config.module.noParse;
    config.module.noParse = existing
      ? (Array.isArray(existing) ? existing : [existing]).concat(
          /elk\.bundled\.js$/,
        )
      : /elk\.bundled\.js$/;
  }

  return config;
};
```

## Why This Works

1. **Separate Worker Chunk**: The `new URL(..., import.meta.url)` pattern tells webpack to:
   - Compile `elk-layout.worker.ts` as a separate chunk
   - Give it its own webpack runtime
   - Load it as an actual Web Worker

2. **Untransformed ELK**: The `noParse` configuration tells webpack to:
   - Include `elk.bundled.js` verbatim without any transformations
   - Leave `new Worker(...)` calls intact
   - When ELK runs inside our worker, it detects the worker context and runs synchronously

## Verification

### Build Output

```bash
yarn build
# Should complete successfully with no Worker errors
```

### Runtime Check

Open DevTools → Sources → Page. You should see:

- A separate worker script: `_next/static/chunks/[hash].worker.js`
- NOT bundled in `app-pages-browser` chunks

### Browser Console

No errors like:

- ❌ `_Worker is not a constructor`
- ❌ `Cannot construct an ELK without both 'workerUrl' and 'workerFactory'`

## Files Modified

1. **`apps/web/features/hexagon-canvas/hooks/useElkLayout.ts`**
   - Changed worker instantiation to use `new URL(..., import.meta.url)` pattern
   - Used relative path instead of alias

2. **`apps/web/next.config.mjs`**
   - Added `noParse` for `elk.bundled.js`
   - Only applies to client-side builds (`!isServer`)

3. **`apps/web/app/workers/elk-layout.worker.ts`**
   - Imports `elkjs/lib/elk.bundled.js` (unchanged)
   - Runs layout algorithm synchronously in worker context

## Alternative Approaches (Why They Don't Work)

### ❌ Use webpack `externals`

- Skips bundling, expects global at runtime
- ELK has no CDN global in worker context

### ❌ Use `enabledLibraryTypes: ['module']`

- Requires `experiments.outputModule` which doesn't exist in Next.js
- Causes build error: "library type 'module' is only allowed when 'experiments.outputModule' is enabled"

### ❌ Use path alias in worker URL

- Webpack doesn't recognize aliases in `new URL(..., import.meta.url)`
- Must use relative path for proper worker chunk compilation

### ✅ Use `new URL` + `noParse`

- Correct worker chunk compilation
- Prevents ELK transformation
- Works with Next.js/webpack 5

## References

- [Webpack 5 Web Workers](https://webpack.js.org/guides/web-workers/)
- [Webpack noParse](https://webpack.js.org/configuration/module/#modulenoparse)
- [ELK.js GitHub](https://github.com/kieler/elkjs)
- [Next.js Webpack Config](https://nextjs.org/docs/app/api-reference/next-config-js/webpack)
