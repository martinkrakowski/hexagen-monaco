# Architecture Remediation — Execution Runbook (live)

**Date:** 2026-08-16 · **Status:** **Phases 0–3 COMPLETE; Phase 4 complete except D3/D6.**
Phase 2 went green at `b3f79dd6` — **Phases 5–8 are unblocked**. Phase 5 is the wavefront.

This is the **live operating runbook** for executing the architecture-remediation
arc. It is the companion to — not a replacement for — the two canonical documents,
both already on `main`:

- **Plan** — `docs/planning/2026-08-14-architecture-remediation-plan.md` (waves 0–8,
  the full finding→item index, decision notes D1–D6). Merged in PR #437 (`c9a14f48`).
- **Implementation prompt** — `docs/planning/2026-08-14-architecture-remediation-implementation-prompt.md`
  (the orchestrator hand-off: prime directive, delegation model, per-item loop, phase
  gating, per-phase runbook, decision/release gates, global constraints, governance
  block). Merged in PR #438 (`edccc02c`).

Where those two are the _generic_ plan and hand-off, this file tracks the _live_
execution state: what has landed, what is in flight, and the exact operating model
being run. Update the status table and change log as phases progress.

---

## 1. Status at a glance

| Phase | Scope                             | State                                              | Evidence                                                                                                                                                                                           |
| ----- | --------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | ADRs 0.1–0.8 (ADR-0047…0054)      | ✅ **Merged**                                      | PR #439 (`cd331ae6`); ADR 0.8 accepted → unblocks Phase 2                                                                                                                                          |
| **1** | Prod triage 1.1–1.6               | ✅ **Merged**                                      | #440 `AUD-001`, #441 `AUD-002`, #442 `AUD-007`, #443 `AUD-003/006`, #444 `AUD-005` — all on `main`                                                                                                 |
| **2** | Enforcement ratchet (AUD-010/011) | ✅ **COMPLETE**                                    | **2.1 #452** (`edbe7c2c`), **2.2 #459** (`6a08bc00`), **2.3 #462+#465** (`6942751d`, `b3f79dd6`), **2.4 #460** (`ce53bca2`), **2.5 #448** (`0a22a53d`) — **Phase 2 is green; Waves 5–8 unblocked** |
| **3** | Toolchain honesty (3.1–3.5)       | ✅ **COMPLETE**                                    | **3.1 #445** (`fcbe7cfc`), **3.2 #461** (`c5298c1a`), **3.3 #457** (`c299d967`, MOD-004; MOD-005 leg ⇐ ADR-0049), **3.4 #466** (`03b1369f`), **3.5 #449** (`50081c51`)                             |
| **4** | Dead-code deletion (4.1–4.7)      | 🔄 **5 of 7 — only decision-blocked items remain** | **4.1 #450**, **4.2 #446**, **4.3 #453**, **4.4 #451**, **4.6 #447+#458** (`497c227e`, HEX-037 **and** HEX-038 — no longer partial); **4.5 ⇐ D3**, **4.7 ⇐ D6**                                    |
| **5** | Port identity / app I/O           | 🟢 **UNBLOCKED — next**                            | entry gate **satisfied**: Phase 2 green on `main` as of `b3f79dd6`                                                                                                                                 |
| **6** | Web routes / package fates        | ⛔ **Design-ready**                                | ⇐ 5.5 + ADRs 0.2/0.3/0.4                                                                                                                                                                           |
| **7** | Staged-gen GOD-001 arc            | ⛔ **Design-ready**                                | strict serial 7.1→7.2→7.3→7.4/7.5→7.6                                                                                                                                                              |
| **8** | Web/React + test reality          | ⛔ **Partly blocked**                              | ⇐ 7.1, 6.7(b), 4.3 ✅, **4.5 (⇐ D3)**, 5.2 — startable, not completable until D3                                                                                                                   |

Also merged earlier in the arc: PR #437 (plan, `c9a14f48`), PR #438 (implementation
prompt, `edccc02c`).

### Open items, exactly

**Phases 2, 3 and 4's buildable set are done.** Verified against `main` (`cf7ccc4e`) by
checking the code, not this document: the strict CI gate, the 34-entry ratchet baseline, all
three legs of the lint job, `typecheck:test` in CI, the arch-linter split, the TS6 pin, the
Jest residue, `engines.node`, ts-morph alignment, `Error.cause`, and HEX-038.

**Nothing in Phases 2–4 is blocked on engineering. What remains is blocked on decisions:**

| Item                          | Blocked on                                  | Note                                                                                                           |
| ----------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **4.5**                       | **D3** — api-gateway delete-vs-wire         | also gates **Phase 8**, so D3 compounds                                                                        |
| **4.7**                       | **D6** — sync publish-surface semver        | release-gated                                                                                                  |
| **3.3 MOD-005 leg**           | **ADR-0049** branch selection               | ADR is `Status: Proposed`, both options live; ADR-0049 itself says 3.3 drops the leg under Option B            |
| **8.11**                      | ~~**D4** — coverage posture~~ **unblocked** | **D4 resolved: no coverage gate** (see §2). 8.11's remaining legs are the missing `test` targets, not the gate |
| 11 of the 34 baseline entries | **`zod` in domain** — accept or burn down   | baselined, not allowlisted; ADR-0054 seeds only js-yaml/manifest                                               |

**Release gates pending** (repo PRs landed; nothing published, tagged or deployed): #457
(`engines.node` floor), #459 (three new arch-linter rule classes + empty-by-default
allowlist), #466 (ts-morph major + a Windows path fix in the published engine).

**Repo settings only a human can change:** mark `Lint & Boundaries / ESLint + UI boundary`
a required check, or the new lint workflow gates nothing in practice.

### Known gaps in the gates themselves

Recorded because each is a check that reports more confidence than it has earned — the class
this arc kept surfacing. Tracked in
`docs/planning/2026-08-16-ratchet-and-parser-integrity-plan.md` and
`docs/planning/2026-08-16-verification-coverage-followups.md`, both added by this PR.

- **The arch-lint ratchet is review-enforced, not machine-enforced.** A _stale_ entry warns
  and exits 0; a PR that _grows_ `arch-lint-baseline.json` goes green. "Shrink, never grow" is
  ADR-0054 §1 intent with no machine check behind it.
- **`no-feature-slice-imports` has never seen an `@/` import.** The rule is wired at **error**
  level but returns early on any non-relative specifier, so the boundary it enforces has been
  half-open since it was written. Two violations also sit silenced by inline
  `eslint-disable`, so `eslint features` reports 0 errors across 508 files.
- **`validate-ui-boundary.sh` cannot see `lib/` → `features/` or `app/` → `features/` edges** —
  it iterates only slice directories. That invariant is held by convention.
- **`RefactoringImpactUseCase` discards syntactic diagnostics entirely**, so an unparseable
  consumer file yields a confident, wrong impact report. #466 fixed the compiler version that
  exposed this; it did not fix the class.
- **`typecheck:test` covers 15 of 40 workspaces.** Real today, and it widens automatically as
  workspaces gain the script — `apps/web` alone is ~1200 never-type-checked fixtures.

### Cross-phase gating (the hard constraints)

- **Phase 2 gates Phases 5–8.** The ratchet baseline is item 2.2's artifact; every
  later boundary PR shrinks it. **Do not begin Wave 5 until Wave 2 is green on `main`.**
- **Phase 7 is strictly serial** internally: 7.1 → 7.2 → 7.3 → 7.4/7.5 → 7.6.
- **Phase 8 depends on** 7.1, 6.7(b), 4.3, 4.5, 5.2; **Phase 6 depends on** 5.5.
- **ADR gates** (all ADRs 0.1–0.8 are accepted): items name their ADR prereq in the
  plan's dependency column.

---

## 2. Decision & release gate ledger

| Gate   | Question                    | Blocks   | Status                                                                         |
| ------ | --------------------------- | -------- | ------------------------------------------------------------------------------ |
| **D1** | modify-family gate          | 1.3      | ✅ Resolved — same-origin + rate limit (shipped in #443)                       |
| **D2** | BYOK persistence backend    | 1.4      | ✅ Resolved — better-sqlite3, volume-backed (shipped in #442)                  |
| **D3** | api-gateway delete-vs-wire  | **4.5**  | ⛔ **Open** — surface with trade-offs before building 4.5                      |
| **D4** | coverage posture            | **8.11** | ✅ **Resolved — no coverage gate.** Deferral with a re-open trigger; see below |
| **D5** | TypeScript 6 upgrade        | none     | ⛔ Open — 3.1 deletes the pin regardless; upgrade is its own arc               |
| **D6** | sync publish-surface semver | **4.7**  | ⛔ **Open** — release-gated                                                    |

_ADR 0.3 (security bounded-context fate) independently gates 6.6 and the conditional
MOD-005 leg of 3.3._

### D4 — coverage posture: **no gate.** A deferral, not a rejection

**Decided 2026-08-16.** Dossier §1.4 of
`docs/planning/2026-08-16-decision-dossier-and-remediation-followups.md` carries the full
argument; this is the ledger entry. **No ADR** — a deferral belongs in the ledger, and an
ADR would claim more permanence than the decision has.

**Why not now.** Coverage instruments _the files the runner loads_. Workspaces with no tests
load nothing, so they contribute nothing to the denominator: **the metric rises as the gap
worsens.** Verified against `main` (`af077ebd`) rather than copied forward —
`packages/shared` (50 source files), `packages/model-settings` (15) and `packages/runtime`
(9) carry **no `test` script and zero test files**. `apps/api-gateway` still exists and its
`test` script is the literal stub `echo "No tests configured"`, which `turbo test` counts as
a pass; it has no source of its own, so its fate is D3's question, not this one. A number
that improves when `packages/shared` stays untested is not a check whose scope is visible in
its output — and that is this arc's own thesis, so adopting one here would be self-refuting.

Independently, item **8.10 deletes 24 mock-testing suites**. Any baseline taken before that
lands is invalidated by the arc's own work, and until it lands the number **rewards keeping
the suites the audit called fabricated**.

**Shipped instead** (the honesty half — a dead gate is worse than no gate): the root
`coverage` script (`c8 --lines 80 --functions 80 --branches 80 --statements 80 turbo test`)
and the `c8` devDependency are deleted — nothing in any script, workflow or doc invoked
them, and no `.c8rc` / `.nycrc` / Vitest coverage config has ever existed. `README.md`'s
`yarn test --coverage` is gone: `yarn test` is `turbo test`, and Turbo **rejects** unknown
flags (`unexpected argument '--coverage' found`) rather than forwarding them, so the line
failed before Vitest ever saw it — and there was no provider for Vitest to use either. Its
sibling `yarn test --watch` failed identically and was replaced in the same edit.

**Re-open trigger — all three must hold:**

1. **8.10's mock-suite purge has landed**, so a baseline survives the arc's own deletions;
2. **FU-1 has brought `typecheck:test` to every workspace that has tests**
   (`docs/planning/2026-08-16-verification-coverage-followups.md`; 15 of 40 today);
3. **every workspace with source has a real `test` target** — a target that runs Vitest, not
   `echo "No tests configured"`.

**When re-opened, copy `scripts/check-lint-coverage.mjs`'s shape.** That script is the
in-repo precedent for making a gate's scope visible, and its three moves transfer directly:

- **Enumerate from `package.json`'s `workspaces` globs and assert the skip set is _exactly_ a
  named constant** (`UNLINTED` there; the coverage equivalent is the set of workspaces
  outside the denominator). Drift in **either** direction fails: an undeclared skip **and** a
  stale entry that has since gained the script both exit 1, so the exemption list cannot rot
  into a permanent excuse.
- **Reject targets that satisfy the runner without doing the work.** `invokesEslint()` exists
  because `"lint": "echo ok"` passes `turbo run lint`; the coverage check needs the same
  guard against `echo "No tests configured"`.
- **Print the number before enforcing it** — `Lint coverage: N/M workspaces …` on every run,
  and `exit 2` (not 1) when the check _cannot_ run, so "could not measure" never reads as
  "measured, and it was fine".

Order matters: **land the report, watch it for a wave, then set a threshold.** A percentage
whose denominator is not asserted is the failure class this arc has spent eight phases
removing.

**Release-gated items** (`@hexagen-monaco/sync` + `@hexagen-monaco/arch-linter`
publish surface): **2.2, 3.3's `engines.node` leg (MOD-004), 3.4, 4.7.** The **repo
PR lands normally**; the npm publish and any `vX.Y.Z` tag push wait for **explicit
go-ahead**. Deploys are likewise release-gated (`gh workflow run deploy.yml` only on
explicit instruction).

---

## 3. Delegation model — worker-prepared, Primary-landed

Per the implementation prompt §8 and `.agents/ORCHESTRATOR.md`:

- **Workers** operate in **isolated worktrees with no `node_modules`.** They draft the
  diff + the **failing-first test** and **report** them. Workers **never** run repo
  gates, **never** edit `.architecture/manifest.yaml` or context YAML, **never** run
  `yarn lint:arch`, **never** `git commit`.
- **The Primary (orchestrator)** lands everything: runs the Quality Gate from `main`,
  runs refuter panels, commits (explicit paths, no AI attribution), pushes, opens the
  PR, adjudicates bot findings, posts the reviewer's-guide comment.
- **Port-touching items are worker-prepared / Primary-landed.** Manifest/context-YAML
  edits are **worker-drafted, Primary-applied** per `.agents/yaml-editing-disciplines.md`
  (the Primary runs `lint:arch`).
- **Merge is a human gate throughout.** The Primary never merges; each phase stops at
  the human merge gate. Never merge on a bot's say-so.

---

## 4. Per-item execution loop

> **The binding rules live in the implementation prompt (#438), not here.** This is a
> summary for orientation; it deliberately does not restate the gates, because two copies
> drift. Authoritative: the agent-role table (Scout = read-only pre-flight
> liveness/zero-consumers proof; **Refuter = 2–3 parallel agents, majority verdict**), the
> per-item loop's **"block the item if the scout contradicts the plan"** rule, and Phase 4's
> **scout-proof-mandatory** requirement that every deletion carry a grep + typecheck
> zero-consumers proof. Where this summary and the implementation prompt disagree, the
> implementation prompt wins.

For every item and sub-PR:

1. **Scout** — ground the item in the tree (grep + read), confirm current state, and
   classify buildability against the live gate state.
2. **Failing-first test** — write the RED test before the fix; it must fail on the old
   behavior and pass on the new (`.agents/REVIEW.md` §Handoff).
3. **Implement** in a per-item worktree/branch off `main` (one item = one branch).
4. **Quality Gate** (Primary, from `main`): `build` / `typecheck` / `lint` / `test`,
   plus `lint:arch` for port/adapter/manifest items.
5. **Refuter panel** — mandatory on Wave 1 & Wave 7 items and any high-risk diff;
   verify the RED→GREEN discipline with at least one guard-neutering mutation
   (sentinel-commented, confirmed, restored, grepped clean).
6. **Commit** (Primary) — explicit paths, no `Co-Authored-By`, no "Generated with
   Claude Code" footer, neutral phrasing, no names.
7. **PR** — squash-ready; post the reviewer's-guide comment; pre-empt bot flags with
   inline comments on correct-but-flaggable patterns.
8. **Ratchet burn-down** (Phase 2+) — each boundary PR deletes its own entries from the
   committed baseline.

---

## 5. Current wavefront — Phase 5

**Phases 2/3/4 are closed except for decision-blocked items (§1). Phase 5 is the wavefront.**

**Entry gate satisfied.** Phase 2 went green on `main` at `b3f79dd6` — the arch-lint ratchet
runs in CI against the 34-entry baseline, so every Wave 5+ boundary PR now has an artifact to
burn its own entries out of. That was the whole reason Wave 5 was held.

**Phase 5 build notes carried from §6:**

- **5.3 is three sequential sub-PRs by one worker** — local-llm → migrate `wire.server.ts:526`
  off `createDefaultFallbackChain` then delete it (`buildStagedGenerationFallbackChain`
  **stays**) → extract the `wire.client` `ProjectDiscarded` purge into `discardProject`.
- **5.1 / 5.4 are port-touching** → worker-prepared, Primary-landed (§3).
- **Do NOT swap in project-configuration's looser `Manifest` type in 5.2** — refuted.
- **Each Phase 5 PR deletes its own entries from `.architecture/arch-lint-baseline.json`.**
  That burn-down is the ratchet's purpose. Note the baseline does **not** fail on a stale
  entry (§"Known gaps"), so un-pinning is a review duty, not an automatic one.

**Ordering constraint from adjacent work:** FU-3 (cross-slice extraction) also targets
`apps/web/features/**`, which **Phase 8** touches. Three of nine pins remain, all belonging to
one unlanded extraction. Land FU-3 before Phase 8 starts, or fold it in deliberately — do not
let the two collide by accident.

**Historical snapshot — the Phase 2/3/4 wavefront (2026-08-15 → 16).** Approach: maximal-parallel
implementation of gate-satisfied items in isolated worktrees, with read-only design-scouts for
5–8 alongside. Ran as three waves of build agents plus per-PR review adjudication, landing
#445–#467. Ordering notes that governed it — 2.1+2.3 sharing workflow files, 3.1 before 3.2,
2.3's ratchet leg deferred behind 2.2's baseline — are retained only as a record of how those
PRs were sequenced.

## 6. Phases 5–8 — design-ready behind gates

Not implemented this wavefront (gated). The design-scouts produce ready-to-execute
plans so each phase fires the moment its gate clears:

- **Phase 5** — entry gate **Phase 2 green on `main`**. 5.3 is three sequential sub-PRs
  by one worker (local-llm → migrate `wire.server.ts:526` off
  `createDefaultFallbackChain` then delete it, `buildStagedGenerationFallbackChain`
  **stays** → extract `wire.client` `ProjectDiscarded` purge into `discardProject`).
  5.1/5.4 port-touching. Do **not** swap in project-configuration's looser Manifest
  type in 5.2 (refuted). Each PR deletes its own ratchet-baseline entries.
- **Phase 6** — routes stop constructing adapters; `ports/in`→`ports/out`; package
  fates. 6.4 is one package per PR; 6.5 is one PR per tool family (not one 25-class PR).
  6.4/6.5 port-touching. Refuters on 6.1 (saga vs Wave-1 integration tests) and 6.7(a)
  (sync self-regen **and** external modes both gated — the twice-bitten trap).
- **Phase 7** — GOD-001 decomposition after the structured advisory protocol (AUD-014),
  strict serial order; refuter-mandatory every PR (wire-compat vs the `/stage` adapter
  and the web classifier). Re-exports kept one release; no-behavior-change contract.
- **Phase 8** — web/React splits + real contract tests (echo-fake purge). Many items
  independent (8.3/8.4/8.6–8.9); 8.12 is one small PR each (a–h). web vitest runs from
  `apps/web` cwd; 8.11's coverage posture is blocked by D4.

---

## 7. Global constraints (every commit, PR, comment)

- **No AI attribution** — no `Co-Authored-By: Claude` trailer; no "Generated with
  Claude Code" footer.
- **Neutral phrasing, no names** in PR bodies/comments/commits.
- **Explicit staging only** — named paths, never `git add -A` (untracked WIP docs live
  in the tree).
- **Check the branch every commit** (`git branch --show-current`).
- **Squash-merge** with explicit `--subject`/`--body` — a human triggers the merge.
- **Reviewer's-guide comment** on every PR touched, in addition to the body.
- **Pre-empt bot flags**; **never merge on a bot's say-so**.
- **Release/deploy** only on explicit go-ahead.

---

## 8. Change log

- **2026-08-16** — **D4 resolved: no coverage gate** (§2). A deferral with a three-condition
  re-open trigger, recorded in the ledger rather than an ADR. The dead root `c8` script and
  its devDependency were deleted (nothing invoked them; no coverage config has ever existed
  in this repo), and `README.md`'s `yarn test --coverage` — which fails at Turbo's argument
  parser, before Vitest is even reached — was replaced with the per-workspace forms that
  work. The four-no-tests claim was re-verified against `main` rather than copied: `shared`,
  `model-settings` and `runtime` have no `test` target at all; `apps/api-gateway`'s is a
  passing `echo` stub. **8.11 is no longer decision-blocked** — its remaining work is the
  missing test targets.

- **2026-08-16** — **Phases 2, 3 and 4's buildable set closed; Phase 2 green.** Merged
  #457 (3.3 MOD-004), #458 (4.6 HEX-038 — the leg #447 missed), #459 (2.2 + the 34-entry
  ratchet baseline), #460 (2.4, 188 test type errors fixed with zero suppressions),
  #461 (3.2), #462 + #465 (2.3, all three legs — **#465 made Phase 2 green**), #466 (3.4).
  Plus FU-3 cross-slice extractions #463/#464/#467, taking the alias baseline 9 → 3 pins.

  Three review rounds overturned claims this document would otherwise have recorded as
  settled: #465's unfiltered build was shown to buy nothing for `web` (it sits under the
  manifest's `apps:` key, so the linter never scans it) and is now `--filter='!web'`, a
  subtraction rather than an inclusion list — CI 3m59s → 2m43s. #466's Windows path finding
  proved to be a **production** bug, not a test bug: `getFilePath()` normalizes while
  `workspaceRoot` does not, so the prefix strip was a no-op and every file classified as
  package `unknown` on the one platform CI never runs. #467's import finding was valid
  despite moving verbatim — the barrel it carried went from one landing consumer to ~15
  wizard-side readers.

  Item 2.2's ratchet caught live work within the hour: `yarn lint:arch` rejected #466's first
  fix for importing `node:path` into the application layer.

  New gate gaps recorded in §1 rather than left implicit; two follow-up plans written and
  committed alongside this runbook (`docs/planning/2026-08-16-verification-coverage-followups.md`,
  `docs/planning/2026-08-16-ratchet-and-parser-integrity-plan.md`). Both carry dated status
  notes: **D-S1 is resolved** (all nine cross-slice pins classified as genuine debt, 6 cleared
  by #463/#464/#467), and RI-2's fix is **cheaper** after item 5.7 / #470 puts ts-morph behind
  a DTO port.

- **2026-08-15 (late)** — **Wavefront merged: 9 PRs on `main`, zero open.** #445 (3.1),
  #446 (4.2), #447 (4.6 partial), #448 (2.5), #449 (3.5), #450 (4.1), #451 (4.4),
  #452 (2.1), #453 (4.3). A repo-wide PR-comment sweep ran first: every unresolved review
  thread resolved or refuted, then all nine independently code-reviewed. Per-PR verdicts and
  refutation evidence live in the PR threads and each PR's top-level review summary comment.
  Three defects that reviewers had **not** flagged were found and fixed before merge:
  - **2.1/#452** — making the gate honest revealed the arch-linter bin was **never
    resolvable in CI**, so the architecture gate had verified nothing since inception.
    Yarn writes no `node_modules/.bin` entry when the bin target is a build artifact absent
    at install time, and CI installs once, before the first build. Fixed by resolving via
    the package's own `bin` field, by name.
  - **2.5/#448** — a malformed `layer-rules.yaml` / `linter-config.yaml` silently disabled
    the rules while the linter printed "Architecture is compliant" (same silent-gate class
    as AUD-010). Now classified `loaded | missing | invalid`; invalid is fatal.
  - **4.1/#450** — `GetManifestResourceUseCase` was deleted from code but left declared in
    `.architecture/contexts/infrastructure/sync/context.yaml`, where it feeds the
    hexagonal-map generators as a phantom node.

  Also recorded: #447's `no-empty-port-adapter-stubs` guard asserts on the barrel export
  surface, not directory contents — mutation-tested GREEN when the deleted stub file is
  recreated verbatim. It is covered on CI only by `sync-integrity.yml` force-syncing before
  tests; local runs are unprotected. **Follow-up advised**, plus dropping the now-orphaned
  `jszip` / `@types/jszip` from `packages/project-configuration/package.json`.

  **Next unblocking move: 2.2 → 2.3 → 2.4.** Waves 5–8 stay shut until Phase 2 is green.

- **2026-08-15** — Wavefront landing begun. Scout/design fan-out parsed (16/17
  item scouts + 4 phase designs; 4.3 re-scouted separately). **3.1 landed → PR #445**
  (delete stray `typescript ^6.0.3` pin from agentic-interaction; guard test +
  yarn.lock trim; full gate green). **4.2 landed → PR #446** (delete zero-callers
  `getActiveBackend` + orphaned `DEFAULT_BACKENDS`; zero-consumers proof; port
  interface touched → `lint:arch` green). Both **not merged** — held at the human
  gate. 4.3 re-scout resolved it as a **delete + load-bearing extraction** (phantom
  PR surface out of `useStagedSpecGeneration.ts`, and the inline local-generation
  progress mapping must be extracted to a named module in the same PR). Buildable
  queue: 2.1/2.2/2.4/2.5, 3.2 (⇐3.1)/3.4/3.5, 4.1/4.3/4.4/4.6. D3/D6 surfaced for
  decision (block 4.5/4.7 — design-only until resolved).
- **2026-08-15** — Runbook created. Phase 1 fully merged (#440–#444 on `main`).
  Wavefront for Phases 2/3/4 opened; scout/design workflow `wf_9653a167-575` launched
  (17 item scouts + 4 phase designs). Phases 5–8 held design-ready behind gates.
- **2026-08-14** — Phase 0 merged (#439, ADR-0047…0054); plan (#437) and implementation
  prompt (#438) merged.
