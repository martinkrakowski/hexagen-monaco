# ELK.js Web Worker Fix

## Problem

ELK.js (`elkjs/lib/elk.bundled.js`) contains `new Worker(...)` calls for parallel layout processing. When webpack processes this file, it rewrites these calls into `__webpack_worker__` references, which don't exist when the code runs inside our own Web Worker context.

**Error:** `Uncaught TypeError: _Worker is not a constructor`

## Root Cause

1. We created `elk-layout.worker.ts` to offload layout calculation to a background thread
2. Inside this worker, we import `elkjs/lib/elk.bundled.js`
3. Webpack statically analyzes `elk.bundled.js` and finds `new Worker(...)`
4. Webpack replaces it with its own worker abstraction (`__webpack_worker__`)
5. When our worker tries to run this code, `__webpack_worker__` doesn't exist
6. Result: Worker initialization fails

## Solution

Tell webpack to **not parse** `elk.bundled.js` using the `noParse` configuration. This includes the file verbatim without any transformations.

### Implementation

**File:** `apps/web/next.config.mjs`

```javascript
webpack: (config, { isServer }) => {
  // ... existing config ...

  // Prevent webpack from parsing elk.bundled.js
  // It contains `new Worker(...)` that webpack rewrites into __webpack_worker__,
  // which doesn't exist when the file runs inside our own Web Worker.
  // noParse tells webpack to include the file as-is, unchanged.
  const existing = config.module.noParse;
  config.module.noParse = existing
    ? [].concat(existing, /elk\.bundled\.js$/)
    : /elk\.bundled\.js$/;

  return config;
};
```

## Why This Works

- **`noParse`** tells webpack to include the file as-is, with zero transformations
- ELK's `new Worker(...)` calls remain intact
- When running inside our Web Worker, ELK detects it's already in a worker context
- ELK runs the layout algorithm synchronously instead of spawning nested workers
- No `__webpack_worker__` references are created

## Alternative Approaches (and why they don't work)

### ❌ Use `externals`

- Skips bundling entirely, expects a global at runtime
- ELK has no CDN global available in a worker context

### ❌ Use custom loader

- Re-processes the file with different rules
- Still runs webpack's transforms on it

### ❌ Use webpack alias

- Can redirect imports but doesn't prevent parsing
- Webpack still analyzes and transforms the target file

### ✅ Use `noParse`

- Includes the file verbatim, zero transformations
- Exactly what we need for ELK in a Web Worker

## Files Modified

1. **`apps/web/next.config.mjs`** - Added `noParse` configuration
2. **`apps/web/app/workers/elk-layout.worker.ts`** - Imports `elkjs/lib/elk.bundled.js`

## Verification

```bash
yarn build  # Should complete successfully
yarn dev    # Test in browser - no Worker errors
```

## References

- [Webpack noParse documentation](https://webpack.js.org/configuration/module/#modulenoparse)
- [ELK.js GitHub](https://github.com/kieler/elkjs)
- Original issue: Nested Worker spawning in Web Worker context
