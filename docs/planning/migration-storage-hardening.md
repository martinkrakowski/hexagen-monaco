# Migration & Storage Access Hardening

> **Status:** Planned. Surfaced while fixing the CI log noise in PR #124
> (`[ERROR] Migration orchestrator failed: {"error":{}}`). That PR fixed the
> logger and silenced the benign test output; it deliberately did **not** touch
> the underlying storage-access bug, which is tracked here.

## Problem

Across `@hexagen/web-driver`, browser storage is read via the **bare global
`localStorage`** with no guard. Accessing `localStorage` can _throw_ — not merely
be `undefined` — in several real situations:

- **Private / incognito modes** (some browsers throw `SecurityError` on access).
- **"Block third-party cookies / all storage"** settings.
- **The Node test runner**, which exposes a `localStorage` getter that throws
  without `--localstorage-file` (this is what produced the CI line).

The boot data migration (`MigrationOrchestrator` + its steps) runs on **every
page load** via `wireDependencies()` in `apps/web/app/lib/wire.client.ts`. So in
any storage-blocked browser the migration throws on boot. It's currently
fire-and-forget (`.catch(logger.error)`), so it doesn't crash the page — but it
means the migration silently never runs for those users, and any future caller
that awaits it would break.

There is already a **correct reference implementation in the same package**:
`persistence-domain-registry.ts` wraps every `localStorage` access in
`try/catch` and falls back to a default. The rest of the package should follow
that pattern — ideally via a shared helper rather than scattered try/catch.

## Two workstreams

1. **W1 — Storage-access hardening** (the bug): make every `localStorage` access
   resilient to throwing/unavailable storage.
2. **W2 — Test-double divergence** (what hid the bug): the orchestrator's test
   reimplements the class inline instead of importing it.

---

## W1 — Storage-access hardening

### Approach: one shared helper, used everywhere

Add `packages/web-driver/src/infrastructure/storage/safe-local-storage.ts`:

```ts
/**
 * The localStorage handle, or null when storage is unavailable. Access can
 * THROW (SecurityError in private mode / blocked storage; the Node test runner),
 * so callers must go through this guard rather than touching `localStorage`.
 * Uses `window.localStorage` (not the bare global) so it resolves to the browser
 * store, not the Node test runner's throwing global.
 */
export function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // blocked / unavailable / non-browser runtime
  }
  return null;
}
```

Call-site shape: `const ls = getLocalStorage(); if (!ls) return <fallback>;` then
use `ls.getItem/setItem/removeItem/length/key`.

### Severity tiers / call sites

**P0 — boot path (runs on every page load):**

| File                                           | Accesses                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `migration/migration-orchestrator.ts`          | `getStatus` (getItem), `markComplete` (setItem), `updateLastRun` (setItem) |
| `migration/wizard-draft-migration-step.ts`     | getItem ×2, removeItem ×2                                                  |
| `migration/saved-projects-migration-step.ts`   | getItem, removeItem                                                        |
| `migration/editor-workspace-migration-step.ts` | getItem, removeItem, `length`, `key()`                                     |

After the orchestrator guards `getStatus`, also early-return `[]` from
`runPending()` when `getLocalStorage() === null` (no usable storage ⇒ nothing to
migrate). Each step should treat "no storage" as `{ success: true,
recordsMigrated: 0 }` (nothing to migrate) so the orchestrator marks them done.

**P1 — other consumers (audit + guard, separate PR):**

| File                                           | Notes                                                       |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `storage-quota-monitor.ts`                     | iterates `localStorage.length`/`key()` + getItem/removeItem |
| `adapters/model-verification-cache.adapter.ts` | get/set/removeItem (has some try/catch already — verify)    |
| `adapters/encrypted-session-vault.adapter.ts`  | get/set/removeItem (secrets — fail closed, never throw)     |

**Reference (already correct, do not change):**
`persistence-domain-registry.ts` — the pattern P0/P1 should match.

### Tests (W1)

- `getLocalStorage()` returns `null` (no throw) when `window` is absent and when
  `window.localStorage` is a throwing getter; returns the store when present.
- Orchestrator: `runPending()` resolves to `[]` and `getStatus()` returns
  defaults when storage throws — **without** rejecting. (Enabled by W2.)
- One step: `migrate()` succeeds as a no-op when storage is unavailable.

---

## W2 — Fix the test-double divergence

`packages/web-driver/__tests__/infrastructure/migration/migration-orchestrator.test.ts`
currently defines its **own** inline `MigrationOrchestrator` (≈120 lines) — a copy
that already contains the `getStorage()` try/catch the production class lacks. So
the suite is green while production is buggy, and the test validates nothing real.

### Make it actually run in CI first

The existing `__tests__/` test **does not run today**: web-driver's `test` script
is `node --test 'src/**/*.test.ts' 2>/dev/null || true` (only `src/`, errors
suppressed) and its `tsconfig.json` `include` is `["src/**/*"]`, so `__tests__/`
is neither executed nor compiled. Simply editing that file in place would still
leave CI without the coverage. Pick a home that runs:

- **Recommended (PR 1): put the rewritten test where `tsx --test` already runs —
  `apps/web/**`** (the `apps/web` `test`script is`tsx … --test '**/\*.test.ts'`,
and `apps/web` is the real consumer of the orchestrator). Import the class
  **through the package's public surface, not a relative `src/...` path\*\*:
  - `MigrationOrchestrator` is currently **not** re-exported from
    `packages/web-driver/src/index.ts` — add it to the package's public exports as
    part of this change, then `import { MigrationOrchestrator } from
"@hexagen/web-driver"`. This tests the shipped artifact and avoids
    runner/extension (`.js`/`.ts`) mismatches.
  - Delete the divergent inline reimplementation in
    `packages/web-driver/__tests__/…/migration-orchestrator.test.ts`.
- **Alternative (separate, larger):** give `@hexagen/web-driver` a real
  TS-capable runner (`tsx --test`) and add a test `tsconfig` that includes
  `__tests__/`, so package-local tests run. Keeps unit tests next to the code but
  is broader (the package currently has **no** working test run); track as its own
  cleanup rather than blocking the hardening.

### Test content

- Reconcile the API the inline copy drifted on (it was written against a different
  shape): real status key is `hexagen:migration:status` (copy used `…-status`),
  real `lastRunAt` is `number | null` (copy used `string`), real `getStatus()`
  re-derives from storage each call (copy kept an in-memory `Set`), real
  `runPending()` early-returns when `window` is undefined.
- Drive it via `globalThis.window = { localStorage: mockStorage }` — after W1 the
  real class reads `window.localStorage`, so the mock drives it directly.
- Add the throwing-storage case: define `window.localStorage` as a getter that
  throws and assert `runPending()`/`getStatus()` don't throw.

This makes the test exercise the shipped code **and run in CI**, locking in the
W1 guarantees.

---

## Sequencing, risk, effort

1. **PR 1 (P0 + W2):** `safe-local-storage.ts` helper, route the orchestrator and
   the 3 migration steps through it, add the `runPending` no-storage guard, export
   `MigrationOrchestrator` from the package entrypoint, and add the rewritten test
   under `apps/web/**` (importing via `@hexagen/web-driver`) with throwing-storage
   coverage — deleting the divergent web-driver `__tests__` copy. ~2–3 hrs.
2. **PR 2 (P1):** audit and guard the remaining adapters (quota monitor,
   verification cache, encrypted vault). ~1–2 hrs.

**Risk:** low–moderate. The behavioural change is "when storage is unavailable,
no-op instead of throw," which is the correct semantics. Main care: the W2 test
rewrite must reconcile the real class's API, and `web-driver` is built (`tsc`) and
consumed as `dist/` by `apps/web` — rebuild before integration-checking via
`web:test`.

**Validation:** `apps/web` `web:test` should remain green with **zero** migration
error lines (already true after PR #124's mute, but P0 makes it true for the right
reason); add the unit coverage above.

## Out of scope

- Giving `@hexagen/web-driver` a working package-local test runner (its `test`
  script is a no-op today — see W2's "Alternative"). PR 1 sidesteps this by
  homing the rewritten test in `apps/web/**`; making the package run its own
  `__tests__/` is a worthwhile but separate cleanup.
- A general `SafeStorage` abstraction over IndexedDB as well as localStorage.
