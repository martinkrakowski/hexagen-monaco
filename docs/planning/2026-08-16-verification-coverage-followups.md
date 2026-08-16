# Verification Coverage — Follow-Up Plan (FU-1 / FU-2 / FU-3)

**Date:** 2026-08-16 · **Status:** FU-1 and FU-2 Proposed, buildable now, **not started**.
FU-3 **in progress** — **D-S1 resolved**, 6 of 9 pins cleared, 3 remain.
**Origin:** surfaced by the Phase 2/3/4 wavefront (PRs #457–#462, all merged). Each is a gap
the work exposed rather than created, and each was deliberately left out of scope at the time.

> **Status note — 2026-08-16 (committed with PR #468).** FU-1 and FU-2 are unchanged and
> re-measured as still accurate (see the inline confirmations in each section). FU-3 has
> moved substantially: **D-S1 was resolved by investigation** and three extraction PRs have
> merged. Its section below carries a dated update; the reasoning that produced the plan is
> left intact rather than rewritten.

Locators are durable (file + symbol / command), not line numbers, per planning house style.

---

## Why these three belong in one plan

All three are the same failure shape: **a check that reports success over a smaller domain
than a reader assumes.** `typecheck:test` gates 15 of 40 workspaces; the Jest guard scans
manifests but not workflows; the UI-boundary firewall now catches alias imports but carries
nine pinned exemptions (**three as of 2026-08-16** — see FU-3). None is broken. Each is narrower than its name suggests, which is
precisely the class of defect this wavefront kept finding — seven guards shipped with holes
their own RED→GREEN tests did not catch.

The unifying acceptance criterion: **a check's scope must be visible from its output**, not
discoverable only by reading its source.

---

## FU-1 — `typecheck:test` covers 15 of 40 workspaces

Item 2.4 (#460) added a real CI gate and fixed 188 type errors. The gate is honest about
what it runs — but it runs `typecheck:test` only where that script exists.

**Measured at HEAD (`6942751d`).** _Re-measured 2026-08-16 against `main` after #463–#469:
still **15** workspaces carrying `typecheck:test`. FU-1 is untouched and the table below
stands._

| Bucket                                           |  Count | Workspaces                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has `typecheck:test`                             | **15** | gated today                                                                                                                                                                                                                                                                                                                              |
| Missing, `tsconfig.test.json` **already exists** |  **2** | `apps/web`, `packages/local-llm`                                                                                                                                                                                                                                                                                                         |
| Missing, needs a test tsconfig authored          | **18** | `ai-pipeline`, `core-domain`, `eslint-plugin-ui`, `external-integration`, `governance`, `intent-compiler`, `layout-engine`, `manifest-generation`, `mcp-server`, `prompt-compiler`, `reconciliation-engine`, `report-governance`, `security`, `transaction-system`, `ui-projection-compiler`, `ui`, `web-driver`, `wizard-orchestration` |
| No test files at all                             |  **5** | nothing to gate; correctly absent                                                                                                                                                                                                                                                                                                        |

**Correction to the earlier hand-off note:** it said "4 already have a `tsconfig.test.json`
and need only the script line". Measured, it is **2**, not 4 — `ai-pipeline`'s was deleted by
item 3.2 (#461) as dead config, and `shared` does not carry one. Anyone sizing FU-1.1 from
that note would have been wrong by half.

`apps/web` is the outlier that matters: **~1200 test files** whose fixtures have never been
type-checked. It also already has the config, so it is one script line away — and is very
likely to surface a large error count on first run, in the same shape as the 188 that item
2.4 fixed.

### Items

| #          | Item                                                                    | Gate         | Size                                           |
| ---------- | ----------------------------------------------------------------------- | ------------ | ---------------------------------------------- |
| **FU-1.1** | Add the `typecheck:test` script to `packages/local-llm` (config exists) | none         | XS                                             |
| **FU-1.2** | Add it to `apps/web` and fix the fallout                                | none         | **L** — expect a large error count; land alone |
| **FU-1.3** | Author `tsconfig.test.json` + script for the 18 remaining, in batches   | after FU-1.1 | M each; **do not do all 18 in one PR**         |
| **FU-1.4** | Guard: every workspace with test files declares `typecheck:test`        | after FU-1.3 | S                                              |

**Sequencing rationale.** FU-1.1 first as the cheap proof the pattern works. FU-1.2 alone,
because `apps/web`'s fallout is unbounded and mixing it with mechanical additions makes the
diff unreviewable. FU-1.3 in batches of 3–5 by domain proximity. FU-1.4 last — it can only
be written once the set it asserts over is complete, and it is what stops the gap reopening.

**Do not** silence fallout with `any`, `@ts-expect-error`, `skipLibCheck`, or tsconfig
exclusions. Item 2.4 fixed 188 errors with **zero** suppressions; matching that bar is the
point, since a suppressed error is a gate reporting success over a smaller domain — the very
thing this plan exists to close.

---

## FU-2 — the Jest guard does not scan `.github/workflows/`

`packages/sync/__tests__/no-jest-residue.guard.test.ts` (from #461) walks workspace
manifests and config files. It does not read `.github/workflows/`, so a step running
`npx jest` — or `yarn dlx jest`, which needs no manifest entry at all — reintroduces Jest
into CI with the guard staying green.

**Verified at HEAD: zero `jest` occurrences anywhere under `.github/workflows/`.** So this is
**latent, not live**. _(Re-verified 2026-08-16 after #463–#469: still zero. FU-2 is
unchanged and unstarted.)_ It was left out of #461 deliberately because PR #462 owned CI in the
same wave; both have since merged, so the conflict that justified deferring it is gone.

### Items

| #          | Item                                                                 | Gate | Size |
| ---------- | -------------------------------------------------------------------- | ---- | ---- |
| **FU-2.1** | Extend the guard to scan `.github/workflows/**` for Jest invocations | none | S    |

**Build notes.** Reuse the existing token scanner rather than adding a second matcher — #461
already hardened it for affix forms (`esbuild-jest`, `@sucrase/jest-plugin`) and shell
operators (`tsc&&jest`, `build;jest`), and a parallel implementation would drift from those
fixes. Scan `run:` blocks, and remember a workflow can invoke Jest via a composite action or
a `uses:` step — state explicitly which of those the guard does and does not cover, so the
scope is visible from the output.

**Failing-first:** plant `npx jest` in a workflow, confirm RED, restore by inverse edit
(never `git checkout`), confirm byte-identical. Then **try to fool it** — `yarn dlx jest`,
`npm exec jest`, a variable-indirect invocation. Seven guards in this wavefront shipped with
holes that passed their own RED→GREEN test; assume this one has a hole and go find it.

---

## FU-3 — nine pinned cross-slice couplings

> ### Update — 2026-08-16: D-S1 resolved, 6 of 9 cleared, 3 remain
>
> **D-S1 is settled.** The classification called for by FU-3.1 was carried out per pair, as
> recommended. The verdict came back **unanimous: all nine are (a) genuine debt — zero (b)
> mis-drawn rule, zero (c) accept-and-cap.** The recommendation below to decide per pair
> rather than globally was the right method; it simply converged on one answer. FU-3.3 is
> therefore **moot** — no pair landed as (b), so there is no boundary rule to amend.
>
> **Landed (6 pins cleared), each extraction to a slice-neutral alias root:**
>
> | PR       | Pins cleared | Extraction                                              |
> | -------- | -----------: | ------------------------------------------------------- |
> | **#463** |            1 | generated template manifest → `apps/web/lib/generated/` |
> | **#464** |            1 | app-global local-LLM context → `apps/web/app/lib/`      |
> | **#467** |            4 | shared project-config presets/options → `apps/web/lib/` |
>
> `CROSS_SLICE_ALIAS_BASELINE` in `scripts/validate-ui-boundary.sh` now holds **3** entries,
> all three importing into `manifest-generation`. They belong to **one unlanded extraction**
> — the shared UI those three imports reach for, moving to `apps/web/components/`, which is
> already an alias root resolving before `features/` (`ALIAS_ROOTS_BEFORE_FEATURES="app
components lib hooks"`). So the remaining burn-down is one PR, not three.
>
> **Still outstanding, and not addressed by any of the above:** the _eslint_ half of the alias
> blind spot. `no-feature-slice-imports` is wired at **error** level but returns early on any
> non-relative specifier, so it has never seen an `@/` import. #462 fixed
> `validate-ui-boundary.sh`; the eslint rule remains half-open. FU-3's opening paragraph
> should be read as describing the shell script only.
>
> **Knock-on flagged by #467, for a human:** ADR-0034's "Trade-offs" section justifies a
> hand-synced duplicate by the boundary rule forbidding the import. #467 removed that
> duplicate, so the justification no longer describes the tree. The ADR was deliberately
> **not** edited — amending a merged decision record is a human call.

PR #462 discovered the UI-boundary check was blind to `@/`-alias imports — it read only
relative specifiers while `apps/web` writes 206 imports in alias form, so it printed
`0 violations — PASSED` over 15 real alias-form slice→slice imports. Fixing it required
pinning the existing pairs, or the gate could not go green.

**The nine, as originally pinned in `CROSS_SLICE_ALIAS_BASELINE` in
`scripts/validate-ui-boundary.sh`** (status column added 2026-08-16):

| Importing slice        | Imports from                                                      | Status            |
| ---------------------- | ----------------------------------------------------------------- | ----------------- |
| `governance-assistant` | `@/llm-driver/useLocalLlm`                                        | ✅ cleared — #464 |
| `hexagon-canvas`       | `@/project-wizard/steps/add-ons-step/template-manifest.generated` | ✅ cleared — #463 |
| `landing`              | `@/project-wizard/config`                                         | ✅ cleared — #467 |
| `landing`              | `@/project-wizard/steps/applications-step/applications-config`    | ✅ cleared — #467 |
| `manifest-generation`  | `@/governance-assistant/ModelProgressCard`                        | ⬜ **remains**    |
| `manifest-generation`  | `@/landing/ProjectsShellWithFreeTier`                             | ⬜ **remains**    |
| `manifest-generation`  | `@/landing/domain/createBlankProjectConfig`                       | ✅ cleared — #467 |
| `manifest-generation`  | `@/project-wizard/config`                                         | ✅ cleared — #467 |
| `manifest-generation`  | `@/project-wizard/steps/workspace-governance-step`                | ⬜ **remains**    |

The baseline fails on a **new** pair and on a **stale** entry, so it cannot rot — but it is
accepted debt, and `manifest-generation` reaching into four other slices is the shape of a
slice that has outgrown its boundary. _(That read held up: `manifest-generation` accounts for
all three surviving pins.)_

### Decision gate D-S1 — what these couplings mean · **RESOLVED 2026-08-16 → (a) for all nine**

**Resolution:** investigated per pair; every one of the nine came back **(a) genuine debt**.
Zero (b), zero (c). The three readings below are retained because they are what made the
per-pair investigation the right method rather than a global verdict — not because the
question is still open.

Not inferable from the code; three coherent readings, and they lead to different work:

- **(a) Genuine debt → burn down.** Extract the shared pieces into a neutral location
  (`app/lib`, a shared slice, or a slice-agnostic module) and delete baseline entries as
  each pair goes. Highest value, highest cost, touches five slices.
- **(b) The slice boundary is wrong.** If `manifest-generation` legitimately composes
  `landing` and `project-wizard`, the rule may be mis-drawn rather than the code — a
  shell/host slice composing feature slices is a normal architecture. That is an ADR, not a
  refactor.
- **(c) Accept and cap.** Keep the baseline, add no new pairs. Cheapest, and honest, provided
  it is a decision on the record rather than drift.

**Recommendation: decide (a) vs (b) per pair, not globally.** `template-manifest.generated`
is a generated artifact and probably wants a neutral home regardless (a); `@/project-wizard/config`
imported by three separate slices looks like shared configuration that was never extracted (a);
whereas `manifest-generation` → `ModelProgressCard` may be genuine composition (b). Do not
settle all nine with one verdict.

_Outcome (2026-08-16): the two (a) predictions were confirmed and shipped — #463 gave the
generated manifest a neutral home, #467 extracted the shared project-config vocabulary. The
`ModelProgressCard` (b) hypothesis was **not** borne out; it classified as (a) like the rest._

### Items

| #          | Item                                                                             | Gate         | Size                  | Status                                                    |
| ---------- | -------------------------------------------------------------------------------- | ------------ | --------------------- | --------------------------------------------------------- |
| **FU-3.1** | Classify each of the nine as debt / mis-drawn-rule / accepted; record in an ADR  | **D-S1**     | M — analysis, no code | ✅ classification done — all (a). **ADR not yet written** |
| **FU-3.2** | Burn down the (a) pairs, one slice-pair per PR, deleting its baseline entry      | after FU-3.1 | M each                | 🔄 6 of 9 done (#463/#464/#467); **3 remain in one PR**   |
| **FU-3.3** | If any land as (b), amend the boundary rule + ADR so the exemption is principled | after FU-3.1 | S                     | ⬜ **moot** — no (b) pairs                                |

**Do not** start FU-3.2 before FU-3.1. Refactoring across five slices on an unexamined
premise is how the coupling got here.

**Remaining FU-3 work, 2026-08-16:** (i) the single shared-UI extraction to
`apps/web/components/` that clears the last three pins; (ii) FU-3.1's ADR, which was never
written down even though the classification was performed — the record currently lives only
in the #463/#464/#467 PR bodies; (iii) the eslint-side alias blind spot noted above, which is
a _separate_ gate gap rather than an FU-3 pin.

---

## Verification (all items)

- **Failing-first, then adversarial.** RED before GREEN, then a separate pass asking _"can
  this be trivially fooled?"_ — those are different questions, and only the second one caught
  the seven holes found in this wavefront.
- Mutation-restore by **inverse edit**, never `git checkout`; verify byte-identical after.
- Run from a pristine checkout (`yarn install --immutable`) — a stale `node_modules` hid the
  arch-linter bin bug for months.
- ~~**Known pre-existing, not to be "fixed" incidentally:** `apps/web`'s
  `app/lib/fetch-json.test.ts` fails 12 tests on Node ≥24 (the `vi.unstubAllGlobals()`/jsdom
  hazard from #435). FU-1.2 will run straight into it — report it, do not absorb it.~~
  **Resolved 2026-08-16.** `vitest.setup.ts` now installs its `localStorage`/`sessionStorage`
  outside Vitest's global-stub registry, so `vi.unstubAllGlobals()` can no longer tear them
  out; `apps/web/vitest.setup.test.ts` pins that. The `apps/web` suite is fully green.

## Risks

- **FU-1.2 is unbounded.** ~1200 never-checked fixtures could yield anything from 10 to 500
  errors. Timebox the discovery run before committing to the fix in one PR; if the count is
  large, split by directory and say so rather than quietly narrowing scope.
- **FU-1.3 and FU-1.4 order matters.** Writing the guard first would redden CI for every
  workspace not yet converted.
- **Lockfile contention** is low here — none of these should add dependencies. If FU-1.3
  needs one, stop and report; three lockfile writers collided during this wavefront and it
  cost real time.
- **FU-3.2 is the only item that can break the product.** Slice refactors move runtime code;
  everything else in this plan is configuration and tests.

## Relationship to the remediation arc

**None of this gates the architecture-remediation arc.** These are hygiene items that can run
in the gaps. The arc's own critical path when this was written: wire item **2.3's deferred
arch-lint ratchet leg** (a commented placeholder at `.github/workflows/lint.yml` at the time,
unblocked once 2.2's baseline reached `main`) → Phase 2 green → Phases 5–8 open.

> **Superseded 2026-08-16.** That critical path has fully run. PR **#465** (`b3f79dd6`) wired
> the ratchet leg, **Phase 2 is green**, and **Phases 5–8 are open** — Phase 5 is now the
> wavefront. See `docs/planning/2026-08-15-architecture-remediation-execution-runbook.md` §1
> for live state.

One overlap worth noting: FU-3 touches `apps/web/features/**`, which **Phase 8** also
targets. If FU-3.2 runs late it will collide with Phase 8's web/React splits — either do it
before Phase 8 starts, or fold it into that phase deliberately. _This is now live, not
hypothetical: Phase 5 is running and Phase 8 is startable, so the last three pins should be
cleared before Phase 8's web/React splits begin._
