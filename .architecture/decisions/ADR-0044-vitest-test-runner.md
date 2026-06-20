# ADR-0044: Vitest as the Monorepo Test Runner

**Status:** Accepted
**Date:** 2026-06-19
**Deciders:** Martin Krakowski
**Supersedes:** None
**Amends:** ADR-0000 (clarifies it is bundler-scoped, not a test-runner ban)
**Related:** ADR-0009 (cites Vitest approvingly as published-CLI bundling precedent)

---

## Context

Every package tests on the Node built-in runner (`node:test` + `node:assert/strict`), and
the project tells agents to **never** use Vitest. That prohibition is **convention, not
code** — there is no validation that rejects Vitest. It lives only in docs: this repo's
`AGENTS.md` ("Never suggest: Vitest…") and the scaffolded `.agents/testing.md` /
`.agents/tech-stack.md` templates (the opt-in `agents-md` add-on).

Crucially, **no ADR actually bans Vitest**:

- **ADR-0000** ("Next.js with Webpack over Vite") is about the web app's _bundler_ — RSC,
  API routes, SSR. It says nothing about the _test runner_. The recurring "we chose against
  Vite" memory has been over-applied to Vitest.
- **ADR-0009** cites **Vitest approvingly** as precedent for bundling published CLIs.

We want Vitest as the monorepo runner (and available in generated projects) for: one modern
runner, native ESM/TS transform (no `tsx` loader), `expect()` ergonomics, and — for
`apps/web` — Vitest + jsdom, which resolves the documented test gotchas (dead
`mock.method`, jsdom `<dialog>` subtree, and `.test.tsx` not being CI-gated, issue #335).
Root devDependencies already carry `@testing-library/react` and `vite-tsconfig-paths`, so
the ground was partly prepared.

## Decision

1. **Vitest is the monorepo's test runner**, rolled out incrementally; generated projects
   may use it too.
2. **`expect()` is permitted in Vitest files.** Existing `node:assert/strict` assertions
   are **retained** — `assert.*` throws on failure under any runner, so it keeps working.
   We do **not** mass-rewrite assertions.
3. **The migration is a mechanical runner swap, not an assertion rewrite:**
   `import { … } from "node:test"` → `from "vitest"` (renaming `before`→`beforeAll`,
   `after`→`afterAll`, `mock`→`vi`). Per-runner rule during and after rollout: a Vitest
   file may use `expect()` _or_ `assert.*`; new tests should prefer `expect()`.
4. **Coexistence via Turbo.** `turbo test` runs each package's own `test` script, so
   migrated packages (`vitest run`) and unmigrated packages (`node --import tsx/esm --test`)
   pass together in one `yarn test`. We migrate **package-by-package**; the suite stays
   green throughout.

## Proof (this ADR ships with a spike)

`@hexagen/intent-compiler` was converted as the spike (5 files, 60 tests) and runs green
under Vitest 4.1.9 via `turbo run test` (build deps → `vitest run`). It exercises every
risk in one shot:

- **`.js`→`.ts` resolution** of NodeNext barrels — the single biggest unknown — via
  `resolve.extensionAlias`, the direct analog of the webpack `extensionAlias` ADR-0000
  already relies on.
- **`vi.*` mock conversion**: `mock.method(o,'m',impl)` → `vi.spyOn(o,'m').mockImplementation(impl)`,
  `errorSpy.mock.restore()` → `errorSpy.mockRestore()`, and the call-shape change
  `calls[i].arguments[j]` → `calls[i][j]`.
- **Lifecycle hooks** (`beforeEach`/`afterEach`) and **`assert.*` unchanged** under Vitest.
- **Coexistence**: `@hexagen/governance` (node:test) and `@hexagen/intent-compiler`
  (vitest) both green in a single `turbo run test`.

## Footprint (measured)

398 `*.test.ts` files; 403 import from `node:test`. Only **25** use `node:test` mocks and
**8** use a test-context `(t) =>` — the only non-mechanical conversions. 56 use top-level
`before`/`after`; 102 use `beforeEach`/`afterEach`. ~8,900 `assert.*` calls **stay as-is**.
No ESLint rule enforces the assert/expect policy (docs-only), so nothing blocks `expect()`.

## Key technical decisions

| Decision                                                                          | Rationale                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `resolve.extensionAlias { ".js": [".ts",".tsx",".js"], ".mjs": [".mts",".mjs"] }` | Resolve explicit `.js` barrel specifiers to `.ts` sources; mirrors `next.config.mjs` (ADR-0000). |
| Keep `assert.*`; do **not** rewrite ~8,900 calls                                  | Runner-agnostic; rewriting is churn + risk with no behavioural gain.                             |
| `@hexagen/sync` build stays `tsup`                                                | Vitest is a **devDependency**; the published bundle is unaffected (ADR-0009).                    |
| Per-package `test` scripts drive Turbo                                            | Enables coexistence; no flag day.                                                                |

## Rollout (staged, multi-PR)

- **PR-0 (this ADR + spike):** harness proof on `@hexagen/intent-compiler` + ADR. **Gate.**
- **PR-1:** root Vitest config (shared `extensionAlias`, include globs, jsdom for
  `apps/web`); point Turbo `test` + `@hexagen/sync#test` at Vitest; reusable codemod.
- **PR-2…N:** per-package migration batches (codemod + script flip + the batch's share of
  the 25 mock / 8 context files).
- **PR-final:** generated projects (`packages/sync/src/generators/package-json.ts` emits a
  `vitest run` script + devDep on `--with-tests`), the `agents-md` template, this repo's
  `AGENTS.md`; remove the dead `wizard-orchestration/vitest.config.ts` + `vitest@^1.0.0`
  and the root `tsx` devDep once unused.

## Consequences

**Positive** — one modern runner; `expect()` available; native ESM/TS (drops the `tsx`
loader); jsdom fixes the `apps/web` test gotchas and unblocks CI-gating `.test.tsx` (#335);
generated projects can adopt Vitest.

**Negative / neutral** — a large but mechanical migration (403 runner-swaps; 25 mock files
manual); a new dev toolchain (vite/esbuild/rolldown) — already partly present; the
per-runner assertion rule means two assertion styles coexist until (if ever) `assert.*` is
retired.

## Review triggers

- Revisit the per-runner assertion rule if a single style is later mandated.
- Revisit generated-project defaults if downstream consumers prefer node:test.

## Amendment to ADR-0000

ADR-0000 governs the **web app bundler** (Next.js + Webpack over Vite). It does **not**
decide the test runner. The "never Vitest" guidance in `AGENTS.md` / `.agents/*` predates
this ADR and is **superseded for the test runner** by ADR-0044.
