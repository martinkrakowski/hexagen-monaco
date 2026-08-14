# Architecture remediation — implementation prompt (orchestrated, multi-phase)

**Date:** 2026-08-14 · **Status:** ready to run
**Baseline:** `main` @ `7b2c7248`
**Drives:** [`2026-08-14-architecture-remediation-plan.md`](./2026-08-14-architecture-remediation-plan.md)
(the authoritative item list, dependency graph, and acceptance criteria)

This file is the **execution wrapper** for the remediation plan. Hand it to a fresh
Primary agent to run the plan end-to-end under Orchestrator Mode. It does not restate
every item — the plan's wave tables are the source of truth for _what_ each item is
and _what "done" means_. This prompt encodes _how_ the work is delegated, phased,
gated, and landed, and _which choices must be made by a human first_.

---

## 0. Prime directive (paste this as the orchestrator's operating brief)

> You are the **Lead Architect and Orchestrator** for the Hexagen-Monaco architecture
> remediation. You operate in **Orchestrator Mode** per `AGENTS.md` and the full
> protocol in `.agents/ORCHESTRATOR.md`. **You write no implementation code.** Your
> job is to decompose each plan item, emit a Work Plan, delegate to sub-agents in
> isolated worktrees, run the Quality Gate, adjudicate review bots, and land PRs — in
> the phase order below, respecting every dependency and decision gate.
>
> Authoritative inputs, in precedence order:
>
> 1. `docs/planning/2026-08-14-architecture-remediation-plan.md` — the items, the
>    dependency columns, the per-wave **Delegation** notes, Appendix A
>    (finding→item), and the **Decision notes D1–D6**.
> 2. `.agents/ORCHESTRATOR.md` — role scopes, the mandatory Work Plan table, the
>    Global Governance block, the Quality Gate checklist, and the **Primary-reserved
>    tasks**.
> 3. `.agents/REVIEW.md` — bot-comment adjudication loop **and** the failing-first-
>    test discipline (§Handoff to Develop Mode); `.agents/TESTING.md` — the
>    develop-mode test spec; `.agents/yaml-editing-disciplines.md` — manifest edits.
> 4. `docs/planning/2026-08-13-architecture-review/AUDIT-2026-08-14.md` — the audited
>    ground truth behind every deviation; the archive folder is **superseded and
>    immutable** (do not edit or re-sync it).
>
> When the plan and any older backlog disagree, the plan wins. When this prompt and
> the plan disagree on _what_ an item is, the plan wins; this prompt governs _process_.

---

## 1. Delegation model (condensed from the plan's Execution model)

Roles — the plan widens the `.agents/ORCHESTRATOR.md` sub-agent scopes for this arc
(Domain/Adapter Workers also cover ADR docs, CI workflows, `tools/`, and `apps/web`;
Scout and Refuter are this plan's additions):

| Role               | Agent shape (for the `Agent` tool)                         | Used for                                            |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------- |
| **Scout**          | `subagent_type: Explore`, read-only, no worktree           | Pre-flight liveness / zero-consumers / impact proof |
| **Domain Worker**  | `subagent_type: general-purpose`, `isolation: worktree`    | Domain/application moves, use-case extraction       |
| **Adapter Worker** | `subagent_type: general-purpose`, `isolation: worktree`    | Adapters, routes, composition roots, CI workflows   |
| **Test/QA Worker** | `subagent_type: general-purpose` (may share item worktree) | Failing-first + contract tests, gate runs           |
| **Refuter**        | 2–3 parallel `general-purpose` agents, majority verdict    | Adversarial verification of risky claims/diffs      |

Standing rules (verbatim intent from the plan — do not relax):

- **One item = one delegation unit; each PR = one worktree.** Most items are one PR.
  An item MAY enumerate a fixed, lettered set of sub-PRs (`X.Y(a)/(b)/(c)`) — one per
  package / tool family / leftover finding — and each sub-PR is its own worktree and
  PR. No two items or sub-PRs share a checkout. Item IDs are stable (Appendix A
  traceability). Parallel items get parallel worktrees (`isolation: worktree`);
  worktrees have **no `node_modules`** — run gates from the main checkout or install
  first.
- **Scout before seam edits.** Anything touching a public API, cross-package boundary,
  or injection point gets a scout pass proving the path is live (or dead, for
  deletions) _before_ a worker starts. Deletion items require a **zero-consumers proof
  (grep + typecheck)** recorded in the PR body.
- **Gates between dependent items.** A dependent item does not start until its
  prerequisite is **merged** and the gate is green on `main`:
  `yarn build && yarn typecheck && yarn lint && yarn test`, plus **`yarn lint:arch`**
  (the Quality Gate) for any item touching ports, adapters, or manifests. Independent
  items within a phase fan out concurrently.
- **Primary-reserved tasks stay reserved** (`.agents/ORCHESTRATOR.md` §Primary):
  workers never edit `.architecture/manifest.yaml` or the context-YAML family, never
  run `yarn lint:arch`/the Quality Gate as the gate of record, never `git commit`, and
  never resolve port-ownership conflicts. Workers **stage proposals** (draft YAML
  diffs, staged code); the **Primary applies** manifest-family edits, runs the gates,
  and commits. The port-touching items — **4.1, 4.4, 5.1, 5.4, 6.4, 6.5** — are
  therefore **worker-prepared, Primary-landed**.
- **Verification fan-out on risky phases.** Wave 1 (prod behavior) and Wave 7 (wire
  protocol) add a **Refuter panel** on each PR before human review: agents try to show
  the bug still reproduces / the protocol drifted. Majority-refuted diffs go back to
  the worker.
- **Bot adjudication per `.agents/REVIEW.md`.** Verify every CodeRabbit/qodo comment
  against current code before accepting or refuting; pre-empt known-flaggable patterns
  with inline comments.
- **Effort tiering.** Mechanical deletions/config edits → low-effort workers; seam
  changes, saga/protocol/use-case splits → standard workers + refuters.

---

## 2. The per-item execution loop (run this for every item and sub-PR)

For each item `X.Y` (or sub-PR `X.Y(z)`), the Primary runs this loop. Steps 1, 4, 6,
8, 9 are **Primary-only**; the rest are delegated.

1. **Decompose** (`.agents/ORCHESTRATOR.md` Step 1): state the touched bounded
   context(s) in `manifest.yaml`, the hexagonal layers, and the Turborepo packages.
   No code.
2. **Scout** (if the item touches a seam or is a deletion): spawn an `Explore` agent to
   prove the path is live/dead and enumerate consumers. Capture the grep + typecheck
   evidence for the PR body. **Block the item if the scout contradicts the plan's
   premise** (e.g. finds a live consumer of code the plan calls dead) — surface it, do
   not proceed.
3. **Work Plan table** (`.agents/ORCHESTRATOR.md` Step 3, mandatory): emit the
   `# · Task · Sub-Agent · Scope · Mode · Tag · Depends On` table before instantiating
   any worker.
4. **Provision worktree(s):** one `isolation: worktree` per item/sub-PR. Parallel
   items get parallel worktrees.
5. **Delegate:** spawn the Worker(s) with the Global Governance block (§8 here)
   prepended, plus the item's plan row and acceptance criteria. Test/QA Worker writes
   the **failing-first test before the fix** (`.agents/REVIEW.md` §Handoff). Manifest/context-
   YAML edits are **staged as a proposal only** for port-touching items.
6. **Primary lands manifest-family edits** for reserved items: apply the worker's
   staged YAML diff yourself, following `.agents/yaml-editing-disciplines.md`.
7. **Refuter panel** (Wave 1 & Wave 7 items always; any high-risk diff otherwise):
   2–3 parallel agents prompted to _refute_ the fix (reproduce the bug / show protocol
   drift / find a missed consumer). Majority-refuted → back to step 5.
8. **Quality Gate** (`.agents/ORCHESTRATOR.md` Step 5, non-delegatable): run
   `yarn build && yarn typecheck && yarn lint && yarn test`; run **`yarn lint:arch`**
   for port/adapter/manifest items; walk the checklist (no domain→infra import, no
   port in two contexts, catch→`Result`, files map to manifest elements, test-double
   parity, no `export {}` barrel, `git diff --stat` clean of reformatting).
9. **Land:** Primary `git commit` (never a worker). Open the PR. **Adjudicate bots**
   per `.agents/REVIEW.md`. Post a **reviewer's-guide** comment (what changed, what was
   refuted, what was deferred). **Do not merge** — merge is a human gate. On merge,
   if this item produced ratchet-baseline entries, confirm the merged PR **removed its
   own baseline entries** (Wave 2 onward).

---

## 3. Phase map (Waves 0–8) and cross-phase gating

Phases correspond to the plan's waves. The **critical ordering constraints** are:

- **Start concurrently:** Wave 0 (ADR drafts) ‖ Wave 1 (prod triage — no ADR deps) ‖
  Wave 3's immediately-startable items (**3.1, 3.4, 3.5**; 3.2 waits on 3.1, 3.3 on
  ADR 0.6).
- **Hard gate:** **Wave 2 (enforcement ratchet) must land before the burn-down
  semantics of Waves 5–8.** The ratchet baseline is 2.2's output; every later
  boundary PR shrinks it. Do not begin Wave 5 until Wave 2 is green on `main`.
- **ADR gates:** Waves 2/4/5/6 items name their ADR prerequisite in the plan's
  dependency column (e.g. 2.1/2.2 ⇐ ADR 0.8; 5.1/5.6 ⇐ ADR 0.1; 5.3/5.8 ⇐ ADR 0.5;
  5.9 ⇐ ADR 0.7; 6.4/6.5 ⇐ ADR 0.2; 6.6 ⇐ ADR 0.3; 6.7 ⇐ ADR 0.4). An item cannot
  start until its ADR is **accepted** (Wave 0).
- **Decision gates:** D1–D6 (§5) block specific items until a human resolves them.

Recommended top-level sequence:

```
Phase 0  ADRs (0.1–0.8)          ─┐  concurrent
Phase 1  Prod triage (1.1–1.6)   ─┤  (Wave 3's ADR-free items may also start)
                                  ─┘
Phase 2  Enforcement ratchet      ← after ADR 0.8; GATES Waves 5–8 burn-down
Phase 3  Toolchain honesty        ← 3.1 first; 3.4/3.5 independent
Phase 4  Dead-code deletion       ← scouts first; ADRs 0.1/0.2/0.4 as noted
Phase 5  Port identity / app I/O  ← after Wave 2; ADRs 0.1/0.5/0.7; intra-wave deps
Phase 6  Web routes / pkg fates   ← after 1.2/1.3/1.6, 5.5; ADRs 0.2/0.3/0.4
Phase 7  Staged-gen (GOD-001 arc) ← strict internal order 7.1→7.2→7.3→7.4/7.5→7.6
Phase 8  Web/React + test reality ← after 7.1, 6.7(b), 4.3, 4.5, 5.2 (see columns)
```

---

## 4. Per-phase runbook

Each phase below gives **Objective · Entry gate · Items · Delegation shape · Special
handling · Exit**. Item text, acceptance, and dependencies live in the plan's wave
table — read it alongside this.

### Phase 0 — ADRs (plan §Wave 0)

- **Objective:** land ADR-0047+ codifying the doctrines the code changes assume.
- **Entry gate:** none. Start immediately.
- **Items:** 0.1–0.8. Numbering starts **ADR-0047** (0009/0010 collide — do not
  reuse); assign sequentially at merge. Apply the audit's binding corrections per the
  plan table — notably: **0.2 must formally supersede/amend ADR-0010**; **0.4 must
  supersede ADR-0007's Implementation**; 0.1 is rewritten around dead-copy deletion
  (Wave 4), not import-the-owner; 0.8 is the new enforcement-posture ADR that Wave 2
  implements. C6 is **not** an ADR (folded into 3.1); the TS-6 question is D5.
- **Delegation:** one **Domain Worker per ADR draft** in parallel, each fed the
  candidate text (archive `ADR-CANDIDATES.md`) + the audit corrections. A **Refuter
  panel fact-checks every draft's claims against the tree** before the PR (the
  ADR-0046 protocol; regenerate the 166/7 tallies in 0.1 from the tree — not
  reproducible as written). One PR per ADR, or one batched docs PR; squash-merge.
- **Special handling:** ADRs are docs — no Quality Gate arch-lint, but the refuter
  fact-check is mandatory (claims drive downstream code).
- **Exit:** all ADRs accepted. **ADR 0.8 accepted unblocks Phase 2**; 0.1/0.2/0.3/0.4/
  0.5/0.7 unblock their named items in Waves 4/5/6.

### Phase 1 — Production triage (plan §Wave 1) · **Refuter-mandatory**

- **Objective:** fix the seven missed production findings that outrank everything the
  audit kept (SSE-singleton cache, broken accept/reject compensation, unauth+wildcard-
  CORS modify family, in-memory BYOK revocation, hand-rolled rate limiters, governance
  triplication).
- **Entry gate:** none for 1.1/1.2/1.5; **1.3 blocked by D1**; **1.4 blocked by D2**.
- **Items:** 1.1–1.6. Ordering: **1.2 before 1.6** (shared governance/modify
  plumbing); 1.3 and 1.5 may share a PR. 1.6 is the correctness half of HEX-016 (the
  structural half is 6.3).
- **Delegation:** **Scouts first on 1.1/1.2 to reproduce the bug as a failing test**
  before any fix; **Adapter Workers per item in parallel worktrees**; **Refuter panel
  on every PR** (re-trigger stale-callback leak / broken compensation / anonymous
  mutation). Test/QA Worker builds the **saga integration harness reused by 6.1**.
- **Special handling:** production behavior — refuter fan-out is not optional. 1.3 and
  1.4 stay **parked until D1/D2 are resolved** (§5); do the D-independent items first.
- **Exit:** all six merged, refuters green, gate clean on `main`.

### Phase 2 — Enforcement ratchet (plan §Wave 2) · **gates Waves 5–8**

- **Objective:** make the fence real before remediating behind it. Land strictness as
  a **ratchet**: CI fails on _new_ violations vs a committed baseline; the baseline
  shrinks per later PR.
- **Entry gate:** **ADR 0.8 accepted** (2.1/2.2 implement it). 2.4/2.5 independent.
- **Items:** 2.1–2.5. 2.3's arch-lint-ratchet leg follows 2.1/2.2 (baseline is 2.2's
  output); its eslint + UI-boundary legs are independent.
- **Delegation:** single **Adapter Worker for 2.1+2.3** (same workflow files); a
  **Domain Worker for 2.2** (engine logic) with a dedicated **"irony-check" Test/QA
  Worker** that runs the fixed linter against the host and diffs findings vs the
  review's domain-purity list; low-effort worker for 2.4; Domain Worker for 2.5.
- **Special handling:** **2.2 is a published-package behavior change → release-gated**
  (§6); it ships with the next npm release with release notes. Commit the **ratchet
  baseline** as 2.2's artifact — later phases delete their own entries from it.
- **Exit:** a seeded boundary violation fails CI; all three firewall layers (eslint,
  `validate-ui-boundary.sh`, arch-lint ratchet) run on every PR and the workflow is
  required for merge; baseline committed. **This is the gate for Phase 5.**

### Phase 3 — Toolchain honesty (plan §Wave 3)

- **Objective:** delete the stray TS-6 pin, purge Jest leftovers, fix `engines.node` /
  security tsconfig, align ts-morph, add `Error.cause` + fix the llm-driver retry hang.
- **Entry gate:** **3.1, 3.4, 3.5 startable immediately**; 3.2 after 3.1; 3.3's
  `engines.node` leg ⇐ ADR 0.6 (and its MOD-005 leg only if ADR 0.3 keeps security).
- **Items:** 3.1–3.5. **3.3's `engines.node` leg (MOD-004) and 3.4 are release-gated**
  (§6); 3.3's security-tsconfig leg (MOD-005) is repo-internal and only if ADR 0.3
  keeps the security package.
- **Delegation:** all five are parallel **low-effort workers** except 3.4 and 3.5
  (standard workers; **3.5 gets a Test/QA Worker** for the retry-semantics table tests
  — llm-driver's first real suite).
- **Exit:** merged; note that D5 (TS-6 upgrade) is explicitly _not_ done here — 3.1
  only deletes the pin.

### Phase 4 — Dead-code deletion sweep (plan §Wave 4) · **scout-proof-mandatory**

- **Objective:** delete, don't rename — the audit replaced ten rename/abstract/
  relocate recs with deletions.
- **Entry gate:** 4.1 ⇐ ADR 0.1; 4.4's context.yaml rewrite ⇐ ADR 0.2 _only if_ it
  adopts the new folder doctrine (it need not); **4.5 blocked by D3**; **4.7 blocked by
  D6** and release-gated. Others independent.
- **Items:** 4.1–4.7. **Every deletion needs the scout's zero-consumers proof (grep +
  typecheck + test) in the PR body.**
- **Delegation:** **Scouts fan out first across 4.1–4.6 concurrently** (liveness
  proofs); then **low-effort deletion workers in parallel worktrees**; **one Refuter
  per PR tries to find a live consumer the scout missed.** 4.7 is a publish-surface
  change, not a deletion — verified via **release notes + D6**, not a grep proof.
- **Special handling:** **4.1 and 4.4 are port-touching → worker-prepared,
  Primary-landed.** 4.4's `context.yaml` rewrite is **worker-drafted, Primary-applied**
  per `.agents/yaml-editing-disciplines.md` (the Primary runs `yarn lint:arch`).
- **Exit:** deletions merged with zero-consumers proofs; 4.5/4.7 held on D3/D6.

### Phase 5 — Port identity, application I/O, generated output (plan §Wave 5)

- **Objective:** the surviving hexagonal repairs, resequenced so HEX-012→HEX-008 holds.
- **Entry gate:** **Phase 2 green on `main`** (ratchet burn-down starts here). ADR
  gates: 5.1/5.6 ⇐ ADR 0.1; 5.3/5.8 ⇐ ADR 0.5; 5.9 ⇐ ADR 0.7. Intra-wave: **5.4 ⇐
  5.3(b)**; 5.7 ⇐ 3.4; 5.8 ⇐ 5.3.
- **Items:** 5.1–5.9. 5.3 is **three sequential sub-PRs by one worker** (shared
  context): (a) local-llm; (b) migrate the sole runtime consumer
  `apps/web/app/lib/wire.server.ts:526` off `createDefaultFallbackChain` then delete it
  (distinct from `buildStagedGenerationFallbackChain`, which **stays**) — acceptance:
  the no-`cloudConfig.fallbackChain` default path stays test-covered; (c) extract
  wire.client's inline `ProjectDiscarded` purge into the existing `discardProject`.
- **Delegation:** **Domain Workers per item**; 5.9 is an **Adapter Worker + Test/QA
  Worker** (template + bundle regen + generated-project First-Run-Green via the
  capstone harness). Each PR **deletes its own ratchet-baseline entries**.
- **Special handling:** **5.1 and 5.4 are port-touching → worker-prepared,
  Primary-landed.** Do **not** swap in project-configuration's looser Manifest type in
  5.2 (refuted).
- **Exit:** merged; ratchet baseline shrinks accordingly.

### Phase 6 — Web routes, composition roots, package fates (plan §Wave 6)

- **Objective:** routes stop constructing adapters; ports/in→ports/out; package fates.
- **Entry gate:** 6.1 ⇐ 1.2 and 1.3; 6.2 ⇐ 5.5; 6.3 ⇐ 1.6; 6.4 ⇐ ADR 0.2;
  **6.5 ⇐ 6.4 and ADR 0.2's supersession of ADR-0010**; 6.6 ⇐ ADR 0.3;
  6.7 ⇐ ADR 0.4, and 6.7(d) ⇐ 6.6.
- **Items:** 6.1–6.7. **6.4 is one package per PR:** (a) governance, (b)
  monaco-orchestration, (c) wizard-orchestration, (d) project-configuration (+ (e)
  security if ADR 0.3 keeps it). **6.5 is one PR per tool family:** (a)
  manifest-structure, (b) transaction lifecycle, (c) generation & scaffold — **not one
  25-class PR**. **6.7 is (a) sync stops emitting unused layer folders; (b) remove
  frozen no-code packages; (c) core-domain/runtime re-export real modules; (d)
  tsconfig.base references reconciled.**
- **Delegation:** **Adapter Workers**; **6.4's PRs fan out in parallel worktrees after
  the ADR**; **6.5 sequenced after all of 6.4.** Refuters on **6.1** (saga semantics vs
  the Wave-1 integration tests) and **6.7(a)** (sync self-regen **and** external modes
  both gated — the twice-bitten trap).
- **Special handling:** **6.4 and 6.5 are port-touching → worker-prepared,
  Primary-landed.** 6.6 is gated by **ADR 0.3** (the security-package fate), not a
  decision note.
- **Exit:** merged; ports/out doctrine holds; package fates decided per ADRs.

### Phase 7 — Staged-generation decomposition, the GOD-001 arc (plan §Wave 7) · **Refuter-mandatory**

- **Objective:** decompose GOD-001 after the real prerequisite (the structured advisory
  protocol, AUD-014), not after HEX-011 (refuted).
- **Entry gate:** strict internal order — **7.1 → 7.2 → 7.3** (protocol settles), then
  **7.4/7.5** (7.4 may run parallel to 7.3), then **7.6**.
- **Items:** 7.1–7.6. 7.1 emits a structured `notices` field, backward-compatible for
  one release. 7.5 splits the use-case with **re-exports kept one release** and a
  no-behavior-change contract.
- **Delegation:** **one Domain Worker owns 7.1–7.2 sequentially** (protocol context is
  the hard-won asset); a **Refuter panel drives both orchestrators against the /stage
  adapter and the web classifier after each PR** (wire-compat is the regression risk).
  **7.3 gets a Test/QA Worker** for the round-trip convergence property test; **7.5 is
  a Domain Worker** whose no-behavior-change contract is verified by the existing
  staged-generation suites + the 7.1 notices tests.
- **Special handling:** wire protocol — refuter fan-out mandatory on every PR.
- **Exit:** merged, wire-compat proven, re-exports still present (one-release window).

### Phase 8 — Web/React decomposition and test reality (plan §Wave 8)

- **Objective:** the web-arc splits + real test coverage.
- **Entry gate:** 8.1 ⇐ 7.1; 8.2 ⇐ 8.1 + 4.3; 8.5 ⇐ 8.3 + 8.4; 8.10 ⇐ 6.7(b); 8.11 ⇐
  4.5; 8.12 ⇐ 5.2 (for the GOD-008 residue leg). Many 8.x are independent (8.3, 8.4,
  8.6, 8.7, 8.8, 8.9).
- **Items:** 8.1–8.12. **8.12 is one small PR each:** (a) model-prefs port, (b)
  template-engine path predicates, (c) local-llm port wording, (d) prompt-compiler type
  ownership, (e) intent-compiler invariants, (f) name the scaffold-defaults literal,
  (g) IDB salvage mapper, (h) move the Generate-with-AI screen-flow state machine +
  device copy out of manifest-generation domain.
- **Delegation:** **parallel Adapter Workers per item** (the most independent items in
  the plan); web vitest **run from `apps/web` cwd**; container/presentational test
  conventions per the established gotchas. **8.10's deletion set needs the scout proof
  per suite**; its contract tests are written by **Test/QA Workers per package**.
- **Special handling:** **8.11's coverage posture is blocked by D4.**
- **Exit:** merged; echo-fake purge complete; real contract tests live.

---

## 5. Decision gates — resolve with a human before the blocked item (plan §Decision notes)

Each D blocks **only its own item(s)**. Do the unblocked work first; surface each D
for a decision with the trade-off framed, and **do not choose unilaterally**.

| Decision | Question                                | Blocks   | Note                                                                                                                                               |
| -------- | --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**   | Gate for the architecture-modify family | **1.3**  | Session vs shared-secret vs same-origin+rate-limit; prod is auth-less today — a session requirement changes product behavior                       |
| **D2**   | BYOK persistence backend                | **1.4**  | better-sqlite3 is the de facto standard; confirm before a volume-backed store                                                                      |
| **D3**   | api-gateway fate (delete vs wire)       | **4.5**  | Delete (recommended: removes the fabricated `echo` test signal) vs wire. HEX-033. Not the security-package fate — that is ADR 0.3, which gates 6.6 |
| **D4**   | Coverage posture                        | **8.11** | Per-package vitest coverage on a ratchet, or delete the dead root c8 + drop the 80% claim                                                          |
| **D5**   | TypeScript 6 upgrade                    | none     | C6's surviving question; schedule as its own arc if wanted — 3.1 deletes the pin regardless                                                        |
| **D6**   | sync publish-surface trim semver        | **4.7**  | Breaking for external importers; fold into next minor. Release-gated                                                                               |

_(ADR 0.3 — the security bounded-context fate, a separate decision from D3 —
independently gates 6.6 and the conditional MOD-005 leg of 3.3.)_

---

## 6. Release-gated items — never publish without explicit go-ahead

**2.2, 3.3 (its `engines.node` leg only — MOD-004), 3.4, and 4.7** change the published
packages `@hexagen-monaco/sync` and `@hexagen-monaco/arch-linter` (published via
`.github/workflows/publish.yml`, which strips `private` and keeps `engines`). They
**ride the next npm release** — merge the repo change, but the publish itself (and any
`vX.Y.Z` tag push) waits for **explicit go-ahead**, per standing policy. 3.3's
security-tsconfig leg (MOD-005) is repo-internal. Everything else is repo-internal.
Deploys are likewise release-gated (`gh workflow run deploy.yml --ref main` only on
explicit instruction).

---

## 7. Global constraints (apply to every commit, PR, and comment)

- **No AI attribution.** No `Co-Authored-By: Claude` trailer in commits; no "Generated
  with Claude Code" footer in PR bodies. (Overrides the harness default.)
- **Neutral phrasing, no names.** Never reference an individual by name in PR bodies,
  comments, or commits — use "flag for additional consideration", "release-gated", etc.
- **Explicit staging only.** Stage named paths; never `git add -A` (untracked WIP docs
  live in the tree).
- **Check the branch every commit** (`git branch --show-current`) — branches move
  between turns. One item = one worktree/branch off `main`.
- **Squash-merge** with explicit `--subject`/`--body` (a human triggers the merge).
- **Reviewer's-guide comment** on every PR touched (in addition to the body).
- **Pre-empt bot flags** with inline comments on correct-but-flaggable patterns.
- **Never merge on a bot's say-so** and **never merge PR #437** (the plan's own PR)
  unless explicitly asked. Merge is a human gate throughout.

---

## 8. Global Governance block (prepend to every Worker prompt)

Prepend this to each sub-agent prompt, then append the item's plan row + acceptance
criteria. The first eight bullets are `.agents/ORCHESTRATOR.md` Step 4 **verbatim**;
the three below the marker are **plan-specific additions** (worktree reality,
Primary-reserved boundaries, failing-first discipline):

```
[GLOBAL GOVERNANCE]
- ESM NodeNext: all imports within packages/sync/ require explicit .js extensions
- Hexagonal boundary: Domain layer must import nothing from Infrastructure
- No framework imports in domain entities or value objects
- Catch blocks must return Result<T, E> — never null / false / default
- No self-import by package name inside src/
- No .d.ts files inside src/ directories
- Barrels must not be empty (no `export {}`)
- Any new @hexagen/* import requires a matching package.json dependency update
# --- plan-specific additions (not in ORCHESTRATOR.md Step 4) ---
- You are in a worktree with NO node_modules — do not run repo-wide gates here;
  stage your diff and report it. The Primary runs the Quality Gate from main.
- You NEVER edit .architecture/manifest.yaml or context YAML, never run
  yarn lint:arch, never git commit — stage those as a proposal for the Primary.
- Write the failing-first test BEFORE the fix (.agents/REVIEW.md §Handoff); it must
  fail on the old behavior and pass on the new.
```

---

## 9. Phase completion checklist (Primary tracks per phase)

- [ ] Every item's PR merged (or explicitly parked on a D/release gate, noted where).
- [ ] Quality Gate green on `main` after the phase (`build/typecheck/lint/test` +
      `lint:arch` for port/adapter/manifest items).
- [ ] Every merged boundary PR removed its own ratchet-baseline entries (Phase 2+).
- [ ] Refuter panels ran and passed on all Wave 1 & Wave 7 PRs.
- [ ] Bots adjudicated + reviewer's-guide posted on every PR.
- [ ] Appendix A traceability intact — each finding still lands exactly once; item IDs
      unchanged.
- [ ] Decision/release gates for downstream phases surfaced and, where needed, resolved.
