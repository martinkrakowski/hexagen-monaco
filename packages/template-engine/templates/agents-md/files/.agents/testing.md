# Testing

## Runner & Assertions

- **Runner:** Vitest — `import { describe, it, expect } from "vitest"` (or `test`).
- **Assertions:** either Vitest's `expect()` or `node:assert/strict` (e.g.
  `assert.equal()`, `assert.deepEqual()`) — both are fine; stay consistent per file.
- **Never** introduce Jest, Mocha, or Chai. Vitest is the project's runner.

## Conventions

- **File naming:** `*.test.ts` (or `*.test.tsx` for component tests).
- **Location:** a `__tests__/` directory adjacent to the module under test.
- **Mocks:** prefer Vitest's built-in `vi.fn()` / `vi.spyOn()` / `vi.mock()` over
  external mock libraries. Mock at the boundary (ports/adapters), not deep internals.
- **Determinism:** no real network, clock, or filesystem in unit tests — inject
  a fake at the seam. Integration tests that need real I/O are named and
  isolated.

## What a Good Test Looks Like

- One behaviour per test; the name states the behaviour, not the method.
- Arrange / act / assert, with the assertion targeting observable output.
- Failing first: when fixing a bug, add the test that reproduces it before the
  fix, and confirm it goes red then green.

## Before You Commit

Run the full suite (`yarn test`, i.e. `vitest run`). A red suite blocks the
commit — diagnose, do not skip or delete the failing test to make it pass.
