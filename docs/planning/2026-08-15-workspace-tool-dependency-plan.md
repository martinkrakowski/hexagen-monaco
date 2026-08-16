# Workspace Tool-Dependency Declaration — Plan

**Date:** 2026-08-15 · **Status:** **D-T1 RESOLVED = Option A (declare).** T1/T2/T3 buildable.
**Origin:** Incidental finding while adjudicating review on PR #454. Previously noted, unfixed,
in `docs/planning/2026-07-25-remaining-work-consolidated-plan.md` (§Issue #335 row) as
"`yarn workspace web test` → command not found: vitest bin-resolution gap, repo-wide decision".

Locators are durable (file + symbol / command), not line numbers, per planning house style.

---

## 1. The finding

`yarn workspace @hexagen/web-driver test` fails with `command not found: vitest`, while
`turbo run test --filter=@hexagen/web-driver` runs the same script and passes 49 tests.

**Measured at HEAD (2026-08-15):**

|                                                                  | count  |
| ---------------------------------------------------------------- | ------ |
| Workspaces whose `test` script invokes `vitest`                  | **35** |
| Of those, declaring `vitest` in `dependencies`/`devDependencies` | **0**  |

`vitest@^4.1.9` is declared **only** in the root `package.json`. All 35 workspaces resolve it
by hoisting plus whatever `PATH` the caller happens to provide.

### What works and what does not

| Command                                    | Result                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `yarn test` (root → `turbo test`)          | ✅ works                                                          |
| `turbo run test --filter=<pkg>`            | ✅ works (verified with `--force`: 0 cached, tests genuinely ran) |
| `yarn vitest run <path>` from repo root    | ✅ works                                                          |
| **`yarn workspace <pkg> test`**            | ❌ `command not found: vitest`                                    |
| **`cd packages/<pkg> && yarn test`**       | ❌ `command not found: vitest`                                    |
| **`cd packages/<pkg> && yarn vitest run`** | ❌ `Couldn't find a script named "vitest"`                        |

**`AGENTS.md` §Commands documents `yarn workspace <pkg-name> test` as a supported command.**
It has never worked for any of the 35 workspaces. Every agent and developer following the
repo's own instructions hits a failure that looks like a broken environment.

## 2. Root cause

Undeclared dependency. A workspace that invokes a binary it does not declare has no
guaranteed `.bin` entry of its own; Yarn's `run` correctly refuses to resolve it. Turbo
succeeds only because it injects the root `node_modules/.bin` into `PATH` — an
implementation detail of the runner, not a property of the packages.

This is the **same class** as AUD-010's arch-linter bin gap fixed in #452: a tool resolved
by ambient convention rather than by declaration, working in exactly one invocation path and
silently failing in others. It is the second instance found this month, which is the argument
for fixing the class rather than the instance.

**Not affected:** published consumers. `devDependencies` are not installed by consumers, and
both publish candidates (`@hexagen/sync`, `@hexagen/arch-linter`) are `private: true` in-repo
and publish under `@hexagen-monaco/*`. This is a developer-experience and CI-robustness
problem, not a shipped-artifact problem.

## 3. Why it is worth fixing

1. **The documented command is broken.** `AGENTS.md` tells every agent to run it.
2. **Single point of failure.** All 35 packages depend on one runner's `PATH` behaviour. A
   Turbo upgrade that changes it breaks the entire test suite at once, with no per-package
   fallback.
3. **Version pinning is fictional.** Each package silently gets root's `^4.1.9`. A package
   that needs a different Vitest major cannot express it.
4. **It teaches the wrong pattern.** New packages are copied from existing ones, so the
   undeclared-tool habit propagates — which is how the arch-linter case arose.

## 4. Decision gate D-T1 — declare, or centralise honestly

Two coherent end states. **This plan does not pick unilaterally.**

**Option A — declare `vitest` in each of the 35 workspaces (recommended).**
`"vitest": "^4.1.9"` in each `devDependencies`, matching root exactly.

- ➕ Every documented command works from anywhere.
- ➕ Removes the single point of failure; packages are self-describing.
- ➕ Makes per-package version divergence expressible if ever needed.
- ➖ 35 `package.json` edits plus one `yarn.lock` regeneration.
- ➖ Root-hoisting keeps disk cost ~zero, but the lockfile diff is wide and will conflict
  with any in-flight branch touching `package.json`.

**Option B — keep tooling root-only and make that the documented contract.**
Fix `AGENTS.md` to state that per-package test invocation is `turbo run test --filter=<pkg>`
or `yarn vitest run <path>` from the root, and that `yarn workspace <pkg> test` is
unsupported.

- ➕ Zero dependency churn; one doc edit.
- ➕ Honest about how the repo actually works.
- ➖ Leaves the single point of failure and the fictional pinning intact.
- ➖ Fights muscle memory — `yarn workspace <pkg> <script>` is the standard Yarn idiom, and
  it will keep being typed.

**Recommendation: A**, with B's doc correction folded in regardless, because `AGENTS.md` is
wrong under either option — under A it becomes true, under B it must be rewritten.

> **DECIDED 2026-08-15 — Option A.** The deciding evidence is that **A completes a convention
> this repo already follows** rather than introducing one. Tools invoked by package-level
> scripts are already declared per package: `typescript` in **37** workspaces, `tsx` in **26**,
> `eslint` in **16**. `vitest` at **0** is the anomaly — almost certainly an artifact of the
> ADR-0044 migration, since `node:test` needed no dependency and nothing was added when the
> scripts were rewritten. `prettier` and `turbo` at 0 are correct and stay that way: they are
> root orchestration, never invoked from a package's own scripts.
>
> The cost objection ("36 places to bump") is answered by **T5**, added below: `yarn
constraints` is available in this repo (Yarn 4 built-in; no `yarn.config.cjs` exists yet)
> and can enforce range agreement across workspaces as a check failure rather than a
> discovered surprise. That also covers `typescript` and `tsx`, which have 37 and 26
> declarations today with nothing keeping them aligned.

A third option — a root `.bin` shim or a `PATH` wrapper script — is **rejected**: it
reproduces the ambient-resolution pattern that caused the problem.

## 5. Items

Sized for one PR each. T1 is the only one gated on D-T1.

| #      | Item                                                                                                                     | Gate         | Notes                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------- |
| **T1** | Declare `vitest@^4.1.9` as a `devDependency` in the 35 workspaces whose `test` script invokes it; regenerate `yarn.lock` | **D-T1 = A** | Mechanical. Land alone — the lockfile diff conflicts with anything touching `package.json`.    |
| **T2** | Correct `AGENTS.md` §Commands so every documented test command is one that works                                         | none         | Do first if D-T1 resolves to B; do alongside T1 if A.                                          |
| **T3** | Guard test: every workspace whose `test` script names a binary declares that binary                                      | after T1     | Prevents regression and generalises past `vitest`. See §6.                                     |
| **T4** | Audit the same pattern for other tools — `prettier`, `eslint`, `tsx`, `turbo`, `tsup`                                    | none         | Read-only scout; may produce zero or several follow-ups. Do not fold into T1.                  |
| **T5** | `yarn.config.cjs` constraint: workspaces declaring a shared tool must match root's range                                 | after T1     | Answers the version-drift cost of Option A. Covers `vitest`, `typescript`, `tsx`. Separate PR. |

### T3 — the guard that makes this stick

The interesting item, and the reason this is a plan rather than a chore. A test that parses
each workspace's `scripts`, extracts the leading binary of each command, and asserts it is
either a declared dependency of that workspace, a Node builtin, or an allow-listed shell
builtin. That converts a convention into a checked invariant, which is exactly what #452
established for the arch-linter and what neither instance had before.

Failing-first discipline: write it against HEAD _before_ T1 and confirm it reports **35**
violations; after T1 it must report zero. A guard that passes on both sides proves nothing —
this is the failure mode found in #447, whose guard stayed GREEN when the deleted stub was
recreated.

## 6. Verification

Acceptance for T1, run from a **pristine** checkout (`yarn install --immutable`) — the
arch-linter lesson is that a stale local `node_modules` hides exactly this class of bug:

- `yarn workspace @hexagen/web-driver test` → passes.
- `cd packages/web-driver && yarn test` → passes.
- `turbo run test` → unchanged, all green.
- `yarn install --immutable` → clean, no lockfile drift (the CI failure mode that reddened
  #448).
- Spot-check three packages with different shapes: `apps/web` (jsdom + its own
  `vitest.config.ts`), `packages/sync` (heavy integration suite), `tools/arch-linter`
  (recently migrated in #448).

## 7. Risks

- **Lockfile conflict.** T1 rewrites `yarn.lock`. Land it when no other `package.json`-touching
  branch is open, or expect a rebase. Cheap to redo, annoying to merge.
- **Version drift.** Declaring `^4.1.9` in 35 places means 36 spots to bump. T3 could be
  extended to assert the declared range matches root's, but that is a follow-up, not a
  blocker.
- **Turbo cache invalidation.** Editing 35 `package.json` files busts the cache for their
  tasks. One slow CI run, then normal.

## 8. Open questions for the decision

1. **D-T1: A or B?** Recommendation above.
2. Should T3 also assert _version agreement_ with root, or only presence? Presence is the
   bug that was found; agreement is stricter and may be noisy.
3. Is `yarn workspace <pkg> test` a workflow anyone actually wants, or is `turbo run test
--filter` the real habit? If the latter, B plus T3 is the smaller honest fix and T1 can be
   skipped — but `AGENTS.md` still has to change.
