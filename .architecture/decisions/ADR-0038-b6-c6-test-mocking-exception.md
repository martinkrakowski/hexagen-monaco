# ADR-0038 — B6/C6 Test Mocking Strategy Exception

**Status:** Accepted — **partially superseded by ADR-0044 (test runner only)**
**Date:** 2026-05-16
**Deciders:** martinkrakowski
**Related Plan:** `docs/planning/AI-Generated-Structured-config-import-plan-remaining.md`
**ADR Number:** 0038 (next available after ADR-0037)

> **Runner note (added after ADR-0044).** The Context below describes `node:test` + `tsx`
> as the established infrastructure, and §"Why we're violating AGENTS.md" quotes the
> then-current "Never suggest: Vitest…" line. Both are accurate records of 2026-05-16 and
> are left unedited. **ADR-0044 superseded that runner choice**: Vitest is now the monorepo
> runner and must not be treated as prohibited. This ADR's actual decision — the targeted
> mocking exception — is unaffected.

---

## Context

The B6 (Workstream B tests) and C6 (Workstream C tests) phases require testing React components that depend on `next/navigation` (`useRouter`). The project's established test infrastructure uses:

- **Test runner:** `node:test` (Node.js built-in)
- **Module resolution:** `tsx` (bundler mode, no Vitest/Jest)
- **Mocking:** `mock.module()` from `node:test` (experimental)

---

## Problem

`mock.module()` from `node:test` requires the `--experimental-test-module-mocking` flag. In the current environment (Node.js v25.2.0):

1. The flag cannot be set via `NODE_OPTIONS` (restricted by Node.js security policy)
2. `tsx` does not forward arbitrary experimental flags to the Node.js runtime
3. Without the flag, `mock.module()` throws or silently fails

**Result:** Test files exist and pass lint, but cannot execute in the current environment.

---

## Considered Options

| Option                                       | Description                                                                                                         | Pros                                          | Cons                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| **1. Wait for Node.js stabilization**        | `mock.module` graduates from experimental in a future Node.js release                                               | No code changes needed                        | Blocks PR #73 indefinitely                                           |
| **2. Use `jest-mock` with `node:test`**      | Use `jest-mock` for mock functions + refactor components to accept router as injectable prop (dependency injection) | Works now, no experimental flags needed       | Violates AGENTS.md §Tech Stack Reference ("Never suggest: ... Jest") |
| **3. Refactor to dependency injection only** | Pass `router` as a prop to all components that use `useRouter()`                                                    | Clean architecture, no mocking library needed | Significant refactor of multiple components                          |
| **4. Skip B6/C6 tests temporarily**          | Commit test stubs, run when environment supports `mock.module`                                                      | PR #73 unblocked now                          | Reduced test coverage, defeats purpose of writing tests              |

---

## Decision

**We are proceeding with Option 2: Use `jest-mock` with `node:test`.**

### Why we're violating AGENTS.md

AGENTS.md §Tech Stack Reference states:

> **Never suggest:** Vitest, Vite bundler, Jest, `expect()` API, `vi.mock()`, `.test.tsx` for unit tests.

We are making a **targeted exception** for the following reasons:

1. **`jest-mock` is not full Jest** — we are only using `jest.fn()` to create mock functions, not the full Jest test framework, matcher library, or `jest.mock()` module mocking
2. **`node:test` remains the test runner** — we are NOT switching to Jest as the test framework
3. **No alternative works in this environment** — `mock.module()` is restricted, Vitest is banned, and dependency injection refactor is out of scope for this PR
4. **Limited scope** — `jest-mock` will ONLY be used in B6/C6 test files, not across the monorepo
5. **Temporary measure** — once Node.js stabilizes `mock.module`, we will migrate back to `node:test` + `mock.module()` and remove `jest-mock` dependency

### What we're actually doing

We are NOT using:

- ❌ Full Jest test framework
- ❌ `jest.mock()` for module mocking
- ❌ `expect()` API from Jest
- ❌ `.test.tsx` as the standard for unit tests (we already use them)

We ARE using:

- ✅ `node:test` as the test runner (per AGENTS.md)
- ✅ `assert` from `node:assert` (per AGENTS.md)
- ✅ `jest.fn()` ONLY to create mock functions that we pass as props (dependency injection)

---

## Implementation Approach

### Step 1: Install `jest-mock`

```bash
cd /Users/martin/Projects/hexagen-monaco/apps/web
yarn add -D jest-mock
```

### Step 2: Refactor components to accept router as prop

Instead of importing `useRouter()` inside the component, accept an optional `router` prop:

```tsx
// BEFORE
import { useRouter } from 'next/navigation';
export function ImportOptionRow({ option }: Props) {
  const router = useRouter();
  return (
    <button onClick={() => router.push(option.href)}>
      ...
    </button>
  );
}

// AFTER
export function ImportOptionRow({
  option,
  router: injectedRouter
}: Props & { router?: { push: (url: string) => void } }) {
  const defaultRouter = useRouter();
  const router = injectedRouter ?? defaultRouter;
  ...
}
```

### Step 3: Update test files to inject mocks

```tsx
import { describe, it } from "node:test";
import assert from "node:assert";
import { jest } from "jest-mock"; // ONLY jest.fn()
import { render, fireEvent } from "@testing-library/react";
import { ImportOptionRow } from "../ImportOptionRow";

describe("ImportOptionRow", () => {
  it("calls router.push on click", () => {
    const mockPush = jest.fn();
    render(<ImportOptionRow option={mockOption} router={{ push: mockPush }} />);
    fireEvent.click(screen.getByRole("button"));
    assert.strictEqual(mockPush.mock.calls.length, 1);
  });
});
```

---

## Consequences

### Positive

1. Tests can execute in the current environment
2. Components become more testable (dependency injection is a good pattern)
3. No experimental Node.js flags needed
4. `node:test` remains the test runner

### Negative

1. **Violates AGENTS.md** — we are using a Jest package (`jest-mock`) despite the "Never suggest: Jest" rule
2. **Additional dependency** — adds `jest-mock` to `apps/web/package.json`
3. **Refactor required** — components need to accept router as a prop
4. **Temporary technical debt** — once `mock.module()` is stable, we should migrate back

### Mitigation

1. Add a `// TODO` comment in each test file linking to this ADR
2. Once Node.js v2X stabilizes `mock.module`, create a follow-up task to:
   - Remove `jest-mock` dependency
   - Remove router prop injection
   - Switch to `mock.module()` pattern
3. Limit `jest-mock` usage to ONLY B6/C6 test files

---

## Review

This decision was made to unblock PR #73 (`feature/ai-generation-page-improvements`). The violation of AGENTS.md is intentional and documented, with a clear migration path once the upstream Node.js issue is resolved.

**Next steps:**

1. Install `jest-mock` in `apps/web`
2. Refactor `ImportOptionRow`, `ImportSelectionPage`, `ImportManifestPage`, `ImportProjectSpecPage` to accept optional `router` prop
3. Update all B6/C6 test files to use `jest.fn()` + injected router
4. Verify tests execute with `npx tsx --test`
5. Commit and push to PR #73
