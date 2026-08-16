# Architecture Remediation — Execution Runbook (live)

**Date:** 2026-08-15 · **Status:** Phases 0–1 merged; Phase 2/3/4 wavefront
**partially landed** (9 PRs merged, zero open); Phases 5–8 still gated on Phase 2.

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

| Phase | Scope                             | State                 | Evidence                                                                                                                                                                                         |
| ----- | --------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0** | ADRs 0.1–0.8 (ADR-0047…0054)      | ✅ **Merged**         | PR #439 (`cd331ae6`); ADR 0.8 accepted → unblocks Phase 2                                                                                                                                        |
| **1** | Prod triage 1.1–1.6               | ✅ **Merged**         | #440 `AUD-001`, #441 `AUD-002`, #442 `AUD-007`, #443 `AUD-003/006`, #444 `AUD-005` — all on `main`                                                                                               |
| **2** | Enforcement ratchet (AUD-010/011) | 🔄 **2 of 5 merged**  | **2.1 ✅ #452** (`edbe7c2c`), **2.5 ✅ #448** (`0a22a53d`); **2.2 / 2.3 / 2.4 unstarted** — still gates Waves 5–8                                                                                |
| **3** | Toolchain honesty (3.1–3.5)       | 🔄 **2 of 5 merged**  | **3.1 ✅ #445** (`fcbe7cfc`), **3.5 ✅ #449** (`50081c51`); **3.2 / 3.3 / 3.4 unstarted**                                                                                                        |
| **4** | Dead-code deletion (4.1–4.7)      | 🔄 **4½ of 7 merged** | **4.1 ✅ #450** (`81606d99`), **4.2 ✅ #446** (`6757fc9e`), **4.3 ✅ #453** (`5e148c0b`), **4.4 ✅ #451** (`05972320`), **4.6 ⚠️ partial — #447** (`f250e427`, HEX-037 only); 4.5 ⇐ D3, 4.7 ⇐ D6 |
| **5** | Port identity / app I/O           | ⛔ **Design-ready**   | entry gate: **Phase 2 green on `main`** — still blocked (2.2/2.3/2.4)                                                                                                                            |
| **6** | Web routes / package fates        | ⛔ **Design-ready**   | ⇐ 5.5 + ADRs 0.2/0.3/0.4                                                                                                                                                                         |
| **7** | Staged-gen GOD-001 arc            | ⛔ **Design-ready**   | strict serial 7.1→7.2→7.3→7.4/7.5→7.6                                                                                                                                                            |
| **8** | Web/React + test reality          | ⛔ **Design-ready**   | ⇐ 7.1, 6.7(b), 4.3 ✅, 4.5, 5.2                                                                                                                                                                  |

Also merged earlier in the arc: PR #437 (plan, `c9a14f48`), PR #438 (implementation
prompt, `edccc02c`).

### Open items, exactly

**Phase 2 — the critical path.** It gates Phases 5–8 and is the least complete:

- **2.2** (AUD-011) — close the layer-rules holes in `tools/arch-linter`. **Also produces
  the ratchet baseline artifact** every later boundary PR burns down, so it blocks 2.3's
  ratchet leg and all of Wave 5+.
- **2.3** (AUD-019) — a real lint job in CI: eslint (workspace), `validate-ui-boundary.sh`,
  arch-lint ratchet. Verified absent from `.github/workflows/` on `main` (only
  `capstone.yml` references eslint).
- **2.4** (AUD-020) — add `typecheck:test` to CI + fix fallout. Verified absent from
  `.github/workflows/` on `main`. Known fallout already catalogued by the PR sweep:
  pre-existing `typecheck:test` errors in `packages/agentic-interaction` (159, use-case
  test mocks) and `packages/sync` (`persistence-fake.test.ts`, `apps.test.ts:674`,
  `resource-use-cases.test.ts:31`).

**Phase 3:** 3.2 (Jest leftovers), 3.3 (`engines.node` per ADR 0.6 + security tsconfig —
MOD-004 leg release-gated), 3.4 (ts-morph alignment across sync ^22 / arch-linter ^27,
release-gated).

**Phase 4:** 4.5 ⇐ **D3**, 4.7 ⇐ **D6** — both deliberately design-only, awaiting decisions.

**Non-blocking follow-ups from the merged set** (recorded so they are not lost; none
gates a phase, none has an owner yet):

- **#447's guard is weaker than its name.** `no-empty-port-adapter-stubs.guard.test.ts`
  asserts on the barrel export surface, not directory contents — mutation-tested GREEN
  when the deleted stub file is recreated verbatim. Protected on CI only because
  `sync-integrity.yml:42` force-syncs before tests at `:67`; local `yarn test` and
  pre-commit runs are unprotected. Fix: assert `!existsSync(externalApisDir)` alongside
  the symbol check. Broadening it to reject _any_ empty adapter class would flag the
  retained `GrokAdapter` and `BullMQAdapter`, so that needs a decision first.
- **Orphaned deps from #447:** `jszip` / `@types/jszip` in
  `packages/project-configuration/package.json` — the deleted `jszip.adapter.ts` was the
  package's only importer.
- **`DownloadProviderPort` has zero implementers** after 4.1/4.6; explicitly deferred by
  #447 to a dedicated port-deletion pass.
- **#450 publishes a type-only breaking change** — `ProjectConfigurationReadPort` left the
  published root entry points of two packages at `0.9.0` on npm. Needs a release note at
  the next version bump.

**⚠️ 4.6 is only half-done.** The plan defines it as two legs — delete the empty
`*PortAdapter` stubs (HEX-037) **and** stop stub-template-resolver importing
composition-root `config.js` (HEX-038). PR #447 landed HEX-037 only. Verified on `main`:
`packages/sync/src/domain/services/stub-template-resolver.ts:12` still reads
`import type { SyncConfig } from "../../config.js"`. **HEX-038 is unstarted** and must not
be marked complete.

### Cross-phase gating (the hard constraints)

- **Phase 2 gates Phases 5–8.** The ratchet baseline is item 2.2's artifact; every
  later boundary PR shrinks it. **Do not begin Wave 5 until Wave 2 is green on `main`.**
- **Phase 7 is strictly serial** internally: 7.1 → 7.2 → 7.3 → 7.4/7.5 → 7.6.
- **Phase 8 depends on** 7.1, 6.7(b), 4.3, 4.5, 5.2; **Phase 6 depends on** 5.5.
- **ADR gates** (all ADRs 0.1–0.8 are accepted): items name their ADR prereq in the
  plan's dependency column.

---

## 2. Decision & release gate ledger

| Gate   | Question                    | Blocks   | Status                                                           |
| ------ | --------------------------- | -------- | ---------------------------------------------------------------- |
| **D1** | modify-family gate          | 1.3      | ✅ Resolved — same-origin + rate limit (shipped in #443)         |
| **D2** | BYOK persistence backend    | 1.4      | ✅ Resolved — better-sqlite3, volume-backed (shipped in #442)    |
| **D3** | api-gateway delete-vs-wire  | **4.5**  | ⛔ **Open** — surface with trade-offs before building 4.5        |
| **D4** | coverage posture            | **8.11** | ⛔ **Open**                                                      |
| **D5** | TypeScript 6 upgrade        | none     | ⛔ Open — 3.1 deletes the pin regardless; upgrade is its own arc |
| **D6** | sync publish-surface semver | **4.7**  | ⛔ **Open** — release-gated                                      |

_ADR 0.3 (security bounded-context fate) independently gates 6.6 and the conditional
MOD-005 leg of 3.3._

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

## 5. Current wavefront — Phases 2 ‖ 3 ‖ 4

**State: the first wavefront pass is complete and merged.** Nine PRs (#445–#453) landed
on `main`; see §8. What remains of Phases 2/3/4 is listed in §1 "Open items, exactly".

**Next pass — the unblocking sequence.** Phase 2 is the critical path because it gates
Phases 5–8, so the next items are, in order:

1. **2.2** (AUD-011) — closes the layer-rules holes **and commits the ratchet baseline
   artifact**. Everything downstream burns down against that baseline, so it goes first.
2. **2.3** (AUD-019) — its eslint and UI-boundary legs are independent and can start in
   parallel with 2.2; its **arch-lint ratchet leg must follow 2.2**.
3. **2.4** (AUD-020) — independent of both; expect fallout in the `typecheck:test`
   errors already catalogued in §1.

Phase 3's 3.2 / 3.3 / 3.4 and Phase 4's 4.6-HEX-038 leg are independent of the above and
can run concurrently in isolated worktrees. Everything still stops at the human merge gate.

**Known handling (carried forward):**

- **4.5 (D3) and 4.7 (D6)** → still **design-only**; D3/D6 surfaced with trade-offs,
  not chosen unilaterally.
- **2.2 / 3.3 (engines.node leg) / 3.4 / 4.7** → repo PR lands; publish release-gated.
- **4.6** → the HEX-038 leg is port-adjacent (`stub-template-resolver` → composition-root
  `config.js`); scout it before editing, per §4 step 1.

**Historical snapshot — the first pass (2026-08-15).** Approach: maximal-parallel
wavefront, implementing the genuinely independent gate-satisfied items of Phases 2/3/4
concurrently in isolated worktrees, with read-only design-scouts for Phases 5–8 running
alongside. Step 1 was a scout/design fan-out (workflow `wf_9653a167-575`, 21 read-only
agents: 17 per-item scouts across 2.1–2.5 / 3.1–3.5 / 4.1–4.7, plus 4 phase design-scouts
for 5–8). Step 2 triaged those specs into buildable-now vs gated and landed each buildable
item as its own PR. Both steps are done; the ordering notes that governed that pass
(2.1+2.3 sharing workflow files under one worker; 3.1 before 3.2) are retained here only
as a record of how the merged PRs were sequenced.

---

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
