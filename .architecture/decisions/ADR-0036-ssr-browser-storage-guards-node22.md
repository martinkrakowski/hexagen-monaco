# ADR-0036: SSR guards for browser storage APIs in Node.js 22+

**Status:** Accepted
**Date:** 2025-05-08
**Deciders:** Engineering

---

## Context

Node.js 22 introduced `localStorage` and `sessionStorage` as globals
(via the Web Storage API, exposed through `node:internal/webstorage`). Unlike
browser implementations, the Node.js implementation requires a
`--localstorage-file <path>` CLI flag to initialise the backing store.
Accessing `localStorage` without that flag throws:

```
SecurityError: Cannot initialize local storage without a `--localstorage-file` path
```

This is a `DOMException` whose `message` property is a getter-only accessor
on `DOMException.prototype` — there is no setter. Attempting to assign to it
(as Next.js's `logErrorWithOriginalStack` does when formatting unhandled
rejections) throws a secondary `TypeError`:

```
TypeError: Cannot set property message of <DOMException> which has only a getter
```

The secondary error obscured the original source. The immediate trigger was
`modelPreferencesStorage.ts` calling `localStorage` synchronously inside
`getModelPreferences`, which was called from `useModelSelectionFlowState`
during SSR of `GenerateWithAi`. Next.js renders `"use client"` components
server-side for the initial HTML payload, so hooks that access browser storage
directly execute in Node.js.

The previously standard guard for this pattern:

```ts
if (typeof localStorage === "undefined") return defaults;
```

no longer works in Node.js 22+ because `typeof localStorage` returns
`"object"` — the global exists — but reading it throws rather than returning
`undefined`.

---

## Decision

All browser storage access across the codebase uses one of two safe patterns.

### Pattern 1 — `isBrowser` flag (module-level)

For modules that need a single guard covering multiple storage calls:

```ts
const isBrowser = (() => {
  try {
    return typeof window !== "undefined" && window.localStorage !== undefined;
  } catch {
    return false;
  }
})();
```

The `try/catch` IIFE handles two cases:

1. `window` is undefined (Node.js without DOM polyfill) — caught by the
   `typeof` check before the `&&` short-circuits.
2. `window.localStorage` exists but throws on access (Node.js 22+ without
   `--localstorage-file`) — caught by the outer `try/catch`.

### Pattern 2 — `getStorage()` accessor

For modules that call storage in multiple places and need the storage object
itself:

```ts
function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
```

All call sites replace bare `localStorage.getItem(...)` with
`getStorage()?.getItem(...)` or an explicit null check.

### What was changed

**`packages/shared/src/infrastructure/adapters/model-preference-storage.ts`**

- `isBrowser` uses the try/catch IIFE
- `getStorage()` returns `window.localStorage` instead of bare `localStorage`

**`apps/web/features/manifest-generation/ModelSelectionFlow/modelPreferencesStorage.ts`**

- Same try/catch IIFE for `isBrowser`
- All `localStorage` access routed through `getStorage()`

**`packages/web-driver/__tests__/.../migration-orchestrator.test.ts`**

- `typeof localStorage === "undefined"` guard replaced with `getStorage()`
  try/catch helper
- Mock updated: `globalThis.window = { localStorage: mockStorage }` instead
  of `globalThis.localStorage = mockStorage` — the new pattern reads from
  `window.localStorage`, not the bare global

---

## Consequences

**Positive**

- Storage access is safe in Node.js 22+ without any process flag changes.
- The `try/catch` pattern correctly handles future Node.js versions that may
  change how Web Storage globals behave.
- Test mocks are now accurate — they set `window.localStorage` which is what
  production code actually reads.

**Negative / trade-offs**

- `typeof localStorage === "undefined"` is no longer a reliable SSR guard on
  Node.js 22+. Existing uses of this pattern elsewhere in the codebase should
  be audited and updated. A lint rule (e.g. a custom ESLint rule or a
  `no-restricted-syntax` entry targeting the string `typeof localStorage`)
  could enforce this going forward.

**Neutral**

- The `try/catch` IIFE has negligible runtime cost — it executes once at
  module evaluation time and the result is cached in a `const`.
- Browser behaviour is unchanged. In a browser, `window.localStorage` is a
  direct property access with no getter that throws, so the try/catch never
  fires in production.

---

## References

- Node.js 22 release notes — Web Storage API
- Next.js issue #54417 — `logErrorWithOriginalStack` crashes on `DOMException`
- ADR-0035 — `@hexagen/local-llm/shared` subpath (related, addresses the
  module graph contamination that exacerbated this error's visibility)
