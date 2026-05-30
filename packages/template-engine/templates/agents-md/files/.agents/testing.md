# Testing

## Runner & Assertions

- **Runner:** the Node.js built-in test runner — `import { test } from "node:test"`.
- **Assertions:** `node:assert/strict` — e.g. `assert.equal()`, `assert.deepEqual()`.
- **Never** introduce Jest, Vitest, Mocha, Chai, or an `expect()` API. If you
  see them suggested, stop and use `node:test` / `node:assert`.

## Conventions

- **File naming:** `*.test.ts` (not `*.spec.ts`).
- **Location:** a `__tests__/` directory adjacent to the module under test.
- **Mocks:** prefer `node:test`'s built-in `mock.fn()` over external mock
  libraries. Mock at the boundary (ports/adapters), not deep internals.
- **Determinism:** no real network, clock, or filesystem in unit tests — inject
  a fake at the seam. Integration tests that need real I/O are named and
  isolated.

## What a Good Test Looks Like

- One behaviour per test; the name states the behaviour, not the method.
- Arrange / act / assert, with the assertion targeting observable output.
- Failing first: when fixing a bug, add the test that reproduces it before the
  fix, and confirm it goes red then green.

## Before You Commit

Run the full suite (`npm test`). A red suite blocks the commit — diagnose, do
not skip or delete the failing test to make it pass.
