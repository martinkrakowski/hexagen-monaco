# Workspace Dependency Hygiene — Follow-Up Plan (T4 / T5)

**Date:** 2026-08-15 · **Status:** Proposed. T4 buildable now; T5 needs decisions **D-V1…D-V4**.
**Parent:** `docs/planning/2026-08-15-workspace-tool-dependency-plan.md` (D-T1 = declare; T1/T3
shipped in PR #455).

Locators are durable (file + symbol / command), not line numbers, per planning house style.

---

## 1. What #455 closed, and what it did not

PR #455 declared the binaries workspace scripts invoke (50 `vitest`, 19 `eslint`, 4 `tsc`
across 39 workspaces) and added `packages/sync/__tests__/workspace-tool-declaration.guard.test.ts`,
which fails if a workspace script invokes a binary no declared dependency provides.

**Closed:** the `scripts` invocation surface. Any future undeclared script-invoked binary is
now a test failure, not a runtime surprise.

**Not closed, and the subject of this plan:**

- **T4** — invocation surfaces the guard deliberately does not inspect: shell scripts under
  `scripts/`, CI workflow steps, and `lint-staged`.
- **T5** — **version** agreement. #455 asserted _declaration_, explicitly not _range
  agreement_. Measuring that afterwards turned up more than untidiness: **19 packages carry
  more than one declared range across workspaces, and six of those are major-version splits.**

## 2. T5 is bigger than a constraints file

The parent plan framed T5 as "add `yarn constraints` so ranges stay aligned". That is the
_prevention_ half. Measurement shows there is a _reconciliation_ half first, because some
workspaces are on different **majors** — different APIs, with hoisting deciding which copy a
given import resolves to.

| Package                  | Root                 | Split observed                                                                                                 | Severity                                                                                      |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@types/node`            | `^22.19.0`           | **20 workspaces on `^20.x`**, 2 on `^22.x`                                                                     | **High** — different Node type surfaces; CI runs 22.7, local dev is on 25                     |
| `eslint`                 | `^8.57.0`            | 32 on `^8.57.0`; `apps/web` `^10.1.0`, `tools/arch-linter` `^9.7.0`, `packages/reconciliation-engine` `^9.0.0` | **High** — ESLint 9 changed the config format (flat config); 8 and 9+ are not interchangeable |
| `react` / `@types/react` | not declared at root | `apps/tui` on `^18.3.1`; others `^19.x`                                                                        | **Medium** — React 18 vs 19 in one repo                                                       |
| `zustand`                | not declared         | `apps/tui` `^4.5.4`; `^5.0.12` elsewhere                                                                       | **Medium** — 4→5 is breaking                                                                  |
| `@dagrejs/dagre`         | not declared         | `packages/layout-engine` `^1.1.4`; `^2.0.4` elsewhere                                                          | **Medium**                                                                                    |
| `elkjs`                  | not declared         | `packages/layout-engine` `^0.9.3`; `^0.11.1` elsewhere                                                         | **Medium**                                                                                    |
| `typescript`             | `^5.4.5`             | 5 ranges; 21 workspaces on `^5.0.0`                                                                            | Low — all resolve to one 5.x                                                                  |
| `tsx`                    | `^4.21.0`            | 4 ranges, all `^4.x`                                                                                           | Low                                                                                           |
| `@typescript-eslint/*`   | `^8.57.0`            | `^8.0.0` ×7, `^8.57.x` ×2                                                                                      | Low                                                                                           |
| `@hexagen/sync`          | —                    | `workspace:*` ×5, `workspace:^` ×1                                                                             | Low — cosmetic, but pick one                                                                  |
| `js-yaml`                | —                    | `^4.1.0` ×3, `^4.1.1` ×15                                                                                      | Trivial                                                                                       |

**Honest note on #455's contribution.** It declared `eslint@^8.57.0` in 19 workspaces that
previously declared nothing. It did not change any workspace that already declared a 9/10
range. So #455 did not create the ESLint split — it made an already-existing split _visible_
by giving the silent majority an explicit declaration. That visibility is the point, but it
does mean the repo now states the contradiction plainly and should resolve it.

## 3. Decision gates

These are per-case and need a human; none is inferable from the code.

- **D-V1 — `@types/node` target.** 20 workspaces say `^20`, root says `^22`, CI runs Node 22.7,
  local dev runs 25. Options: (a) raise all to `^22` matching root and CI; (b) lower root to
  `^20`; (c) leave split. Recommend **(a)** — CI is the environment that matters, and `^20`
  types on a 22 runtime silently under-describe available APIs.
- **D-V2 — ESLint major.** Is the repo on 8 (root, 32 workspaces) or moving to 9+ (`apps/web`,
  `tools/arch-linter`, `packages/reconciliation-engine`)? Flat config makes this a real
  migration, not a bump. Recommend deciding the target and treating the move as **its own
  arc**, not part of this plan. Until then, record the split as intentional.
- **D-V3 — `apps/tui`'s React 18 / zustand 4.** Deliberate pin, or drift? `apps/tui` is Ink-based,
  and Ink's React peer range is the constraint. Needs a look before touching.
- **D-V4 — `packages/layout-engine`'s dagre 1 / elkjs 0.9.** Same question; layout output is
  visually verifiable, so a bump needs a rendering check, not just a green build.

## 4. Items

| #        | Item                                                                                                                                                                                                     | Gate                                          | Size                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- | ----------------------------- |
| **T4.1** | Audit `scripts/*.sh` + `scripts/\*.js                                                                                                                                                                    | ts` for tool invocations not declared at root | none                                          | S — read-only, may yield zero |
| **T4.2** | Audit `.github/workflows/` steps for bare tool invocations                                                                                                                                               | none                                          | S                                             |
| **T4.3** | Extend the guard to `lint-staged` command strings (root `package.json`)                                                                                                                                  | after T4.1/T4.2                               | S                                             |
| **T5.1** | `yarn.config.cjs` constraint: **trivial/low** rows only — one range per package where no major split exists (`typescript`, `tsx`, `js-yaml`, `@typescript-eslint/*`, `@hexagen/sync` workspace protocol) | none                                          | M — mechanical, wide lockfile diff            |
| **T5.2** | `@types/node` reconciliation                                                                                                                                                                             | **D-V1**                                      | M                                             |
| **T5.3** | ESLint major decision recorded; split either resolved or documented as intentional with an allow-list in the constraint                                                                                  | **D-V2**                                      | S (record) / L (migrate)                      |
| **T5.4** | `apps/tui` React/zustand review                                                                                                                                                                          | **D-V3**                                      | S — likely "pinned deliberately, document it" |
| **T5.5** | `packages/layout-engine` dagre/elkjs review                                                                                                                                                              | **D-V4**                                      | M — needs a rendering check                   |

### Why T5.1 is separable and worth doing first

It touches only packages where **every** declared range is within one major, so reconciling
them cannot change behaviour — it is a pure statement-of-intent cleanup that makes the
constraint file possible. Landing it first shrinks the constraint's allow-list to exactly the
genuine splits, which is what makes the remaining rows legible as decisions rather than noise.

### T4's shape

The guard covers `scripts`. What it skips, by construction:

- **Path-invoked commands** (`./scripts/x.sh`, `node dist/cli.js`) — a path is a file, not a
  bin, so declaration does not apply. The tools those scripts invoke _internally_ are the
  actual surface.
- **CI workflow steps.** A sample shows these are almost entirely `yarn <script>`,
  `yarn turbo`, `corepack`, `npm`, `node` — low risk, but `yarn capstone` and any bare binary
  should be confirmed to resolve from a declared dependency rather than the runner image.
- **`lint-staged`**, which invokes `eslint --fix` and `prettier --write` from the root
  manifest. Both are declared at root, so this is currently correct — T4.3 guards it so it
  stays that way, since `prettier` is declared in **zero** workspaces and is exactly the tool
  that would break if someone moved that config into a package.

## 5. Verification

- **T4:** each audit either produces a finding list or an explicit "zero found", recorded in
  the PR. A zero result is a valid outcome and must be stated, not silently omitted.
- **T4.3 / T5.1:** failing-first. Extend or add the guard/constraint, confirm it reports the
  expected non-zero count against HEAD, then fix and confirm zero. A check that passes on
  both sides proves nothing — the failure mode found in #447 and avoided in #455.
- **T5.x:** after any range change, `yarn install --immutable` must be clean and the lockfile
  diff must contain **no unexpected resolution changes**. A range bump that silently moves a
  transitive dependency is the risk; read the lockfile diff, do not just check it is green.
- Run the full gate from a pristine checkout (`yarn install --immutable`) — a stale local
  `node_modules` is what hid the arch-linter bin bug.

## 6. Risks

- **Lockfile contention.** T5.1 and T5.2 both rewrite `yarn.lock`. Land them one at a time,
  and not concurrently with any other `package.json`-touching branch.
- **`yarn constraints` is unused today** — no `yarn.config.cjs` exists. First use should be
  narrow (T5.1's low-risk rows only) so the mechanism is proven before it governs the
  contentious ones.
- **Over-constraining.** A constraint demanding global range equality would forbid legitimate
  divergence (`apps/tui`'s Ink-driven React pin, if D-V3 confirms it). The constraint must
  support a documented exception list, or it will be disabled the first time it is
  inconvenient — which is worse than not having it.
- **ESLint 9 is a migration, not a bump.** If D-V2 chooses 9+, it needs its own plan; folding
  it in here would stall the cheap wins behind a config-format rewrite.

## 7. Sequencing

```
T4.1 ‖ T4.2        (read-only audits, no gates)
   └─ T4.3         (guard lint-staged)
T5.1               (constraint + low-risk range unification)  ← independent, do early
   └─ T5.2         (⇐ D-V1)
      T5.3         (⇐ D-V2 — record or split off as its own arc)
      T5.4 ‖ T5.5  (⇐ D-V3 / D-V4)
```

Nothing here gates the architecture-remediation arc. These are hygiene items that can run in
the gaps between Phase 2 items, and none touches `.architecture/` or a bounded context.
