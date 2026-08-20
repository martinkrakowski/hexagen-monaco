# Brownfield UI — implementation prompt (orchestrated, worktree + sub-agent)

**Date:** 2026-08-20 · **Status:** ready to run
**Baseline:** `origin/main` @ `1eb20679`; the delegation plan's own baseline is `wave-b-8.12h` @ `8791a765` — **fetch before provisioning anything; confirm which of the two is actually on `main` today, since 8.12(h) gates Wave D of the companion remaining-work arc.**
**Drives:** [`2026-08-20-brownfield-ui-plan.md`](./2026-08-20-brownfield-ui-plan.md) (the what/why) with [`2026-08-20-brownfield-ui-feature-plan.md`](./2026-08-20-brownfield-ui-feature-plan.md) as the authoritative item list, packets, DAG, and gates.

This file is the **execution wrapper** for the brownfield UI arc. Hand it to a fresh
Primary agent to run the plan end-to-end under Orchestrator Mode. It does not restate
the packets — the feature plan's §3/§4/§5 tables are the source of truth for _what_
each packet is and what "done" means. This prompt encodes _how_ the work is delegated
into worktrees and sub-agents, phased, gated, and landed — and _which choices must be
made by a human first_.

**No execution runbook exists yet for this arc.** The plan/runbook/implementation-prompt
triad convention used elsewhere in `docs/planning/` calls for a live status ledger
separate from the plan itself. Create
`docs/planning/2026-08-20-brownfield-ui-execution-runbook.md` on the first landing
(status table, decision ledger, do-not-start list, change log) rather than letting
status live only in agent memory or PR comments — the 2026-08-18 remaining-work runbook
going 17 merges stale is the cautionary precedent.

---

## 0. Prime directive (paste as the orchestrator's operating brief)

> You are the **Lead Architect and Orchestrator** for the Hexagen-Monaco brownfield
> import/ratify/install-the-gate arc. You operate in **Orchestrator Mode** per
> `AGENTS.md` and `.agents/ORCHESTRATOR.md`. **You write no implementation code.** You
> decompose packets, emit Work Plans, delegate to sub-agents in isolated worktrees, run
> the Quality Gate, adjudicate review bots, keep the execution runbook current as
> packets merge, and prepare PRs for human merge — respecting every dependency and
> decision gate below.
>
> Authoritative inputs, in precedence order:
>
> 1. `docs/planning/2026-08-20-brownfield-ui-feature-plan.md` — packets, scope fences,
>    RED tests, the dependency DAG (§5), decision gates (§7), cross-cutting
>    requirements (§9), and the full review-adjudication ledger (§11) recording what
>    has already been checked against the tree and does not need re-litigating.
> 2. `docs/planning/2026-08-20-brownfield-ui-plan.md` — screen-level intent, privacy
>    tiers, and the doctrine (ratification, not auto-detection; no confidence theater)
>    when a packet's UX intent needs its original wording.
> 3. `docs/planning/2026-08-20-brownfield-ui-execution-runbook.md` (once created) —
>    live status, decision ledger, do-not-start list.
> 4. `.agents/ORCHESTRATOR.md` / `.agents/REVIEW.md` / `.agents/TESTING.md` /
>    `.agents/yaml-editing-disciplines.md` — process, adjudication, failing-first, YAML.
> 5. `AGENTS.md`, `DESIGN.md` — binding on every packet that touches `apps/web`; read
>    `DESIGN.md` before any UI edit, silently, per the Immutable Anchor.
>
> When this prompt and the feature plan disagree on _what_ a packet is, the feature
> plan wins; this prompt governs _process_. When either document disagrees with the
> tree, the tree wins — re-verify (the feature plan's own §11 ledger is full of cases
> where an earlier draft was wrong and the tree corrected it), update the runbook, then
> act. **A review's say-so is never evidence** — every finding in §11 was independently
> checked against the source before being accepted, and two of three auto-"Addressed"
> bot annotations in round 4 turned out to be false. Hold new findings to the same bar.

---

## 1. Delegation model

Same roles as the companion remaining-work prompt's §1; restated because they are
load-bearing and this arc adds one wrinkle (dual-suite contract tests):

| Role                       | Agent shape                                                | Used for                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scout**                  | `subagent_type: "explore"`, read-only, **no worktree**     | The four named scouts in feature-plan §6.4 (BF-1.2, BF-4.2, BF-6.1, BF-7.1); any seam edit not already scouted in the plan's own exploration record |
| **Domain/Contract Worker** | `subagent_type: "general"`, `isolation: worktree`          | Phase 0 (BF-0.0–0.4), BF-4.2's `sanitizeScope` export, BF-6.1's generalization                                                                      |
| **UI Worker**              | `subagent_type: "general"`, `isolation: worktree`          | Phase 2 primitives, Phase 3/4 screens, Phase 5 UI views, Phase 6 dialog                                                                             |
| **Test/QA Worker**         | `subagent_type: "general"` (may share the item's worktree) | Failing-first tests, the **dual-suite** contract test for BF-0.0/BF-0.1, gate prep                                                                  |
| **Refuter panel**          | 2–3 parallel `subagent_type: "general"`, majority verdict  | **Mandatory** on BF-0.3, BF-0.4, BF-5.2, BF-6.3 (feature-plan §8) — see §4 below for why each                                                       |

Standing rules (do not relax; identical in spirit to the remaining-work arc's, restated
for this one because the two arcs may run concurrently):

- **One item = one worktree = one PR.** Provision with `isolation: worktree` per
  packet; parallel packets get parallel worktrees. Worktrees have **no `node_modules`**
  — workers stage diffs and report; the Primary runs gates from the main checkout.
- **BF-0.1 → BF-0.2 → BF-0.3 is a serialization chain, not a stack.** This repo does
  not do stacked PRs (verified: no `wt-`-style stacking convention exists;
  dependency-serialization is the house model). Each of the three lands, merges to
  `main`, and only then does the next packet's worktree get provisioned from the
  updated `main`. Do not try to open all three PRs at once against a common base.
- **Concurrency cap: ≤4 open PRs from this arc at any time.** The feature plan's
  branch convention is `wave-bf-<packet>` (§5), matching the `wave-*` family the
  companion remaining-work arc also uses for its cap. **If both arcs run at once,
  confirm with whoever is running the remaining-work arc whether the ≤4 cap is a
  shared global count (by label) or independent per arc — do not assume either way,
  and do not let this arc silently blow through a shared budget.**
- **Fan out independent packets; serialize dependent ones.** A dependent packet starts
  only when its prerequisite is **merged and green on `main`**, per the feature plan's
  §5 DAG. Independent packets run as concurrent worker agents launched in the same turn.
- **Scout before seam edits — as a sub-agent, before the worker exists.** The feature
  plan's §6.4 already names four packets that need this (BF-1.2, BF-4.2, BF-6.1,
  BF-7.1). If a packet not on that list turns out to touch a shared barrel, an existing
  hook's consumers, or anything with more than one caller, scout it anyway before
  provisioning — do not treat the four-item list as exhaustive, treat it as the
  already-known cases.
- **Primary-reserved stays reserved:** workers never edit `.architecture/**`, never run
  `yarn lint:arch`, never `git commit`. No packet in this arc touches `.architecture/**`
  directly — the closest is BF-6.1/BF-6.2, which generate `.architecture/*` content
  _for a target repo_, not this one. If a worker reports needing to touch this repo's
  own `.architecture/**`, stop and report; it is out of scope for every packet here.
- **The two security packets (BF-0.4, BF-6.3) are not effort-tiered down, ever.**
  BF-0.4 fixes a live defect in shipped #558 and must land before any public Tier A/C
  traffic; BF-6.3 opens the product's first repo-write surface beyond the existing
  publish flow. Both get a refuter panel and a worker briefed on the threat model, not
  a mechanical-batch worker.

## 2. Per-item execution loop

Run the remaining-work prompt's §2 loop, with the amendments below layered on top of
the feature plan's own §6.2 per-packet worker contract (scope fence, failing-first,
no gates in the worktree, never commit/edit-`.architecture`/run-`lint:arch`, report
shape):

1. **Step 0 (gate check):** before provisioning, check the feature plan's §7 decision
   gates and this prompt's §5 below. If the packet is behind an unresolved gate, do not
   provision a worktree — surface the gate instead, with its recommendation.
2. **Step 0.5 (dual-suite check, Phase 0 only):** for BF-0.0 and BF-0.1, confirm both
   the `packages/sync` producer test and the `apps/web` consumer test are named in the
   Work Plan as separate deliverables before delegating — the feature plan's §8 makes
   the Quality Gate fail, not warn, if either suite didn't run, and a worker who treats
   this as one test will silently under-deliver.
3. **Step 10 (runbook update):** on merge, update the execution runbook — status row,
   decision ledger, change-log entry with the merge SHA and the quoted `yarn test`
   suite count. A merge that doesn't update the runbook is unfinished.

The loop, condensed: decompose → scout (where §6.4 or step 0.5 names it) → Work Plan
table → provision worktree → delegate with the §6 governance block prepended → Primary
lands anything Primary-reserved → refuter panel where §1/§4 mandates it → Quality Gate
(Primary, from main checkout, both suites for Phase 0) → prepare for human merge,
adjudicate bots per `.agents/REVIEW.md`, reviewer's-guide comment → human merges.

## 3. Wave map, gating, and the opening fan-out

The feature plan's §5 DAG is authoritative; this section is the execution-turn view of
it — which packets to actually launch, in what order, respecting the ≤4 cap.

```text
Gates:  BF-0.0 ⟶ BF-0.1 ⟶ BF-0.2 ⟶ BF-0.3          BF-2.0 ⟶ {BF-2.1, BF-2.2, BF-2.3}
        BF-3.1 ⟶ {BF-3.2, BF-3.3, BF-3.4, BF-4.*}   BF-6.1 ⟶ {BF-6.2, BF-6.3}
        D-U1 ⟶ BF-5.1 ⟶ D-P1 ⟶ BF-5.2 ⟶ BF-5.3      BF-4.2 ⟶ BF-4.3
        MVP = Phase 0 + Phase 1 + Phase 2 + Phase 3 + BF-6.1 + BF-6.2
```

**Opening fan-out (launch these four, day one — all have no unmet dependency):**

1. **BF-0.0** — the shared-schema packet. Gates BF-0.1/0.2/0.3 and, transitively, the
   entire Phase-0 contract-truth story. Staff it first.
2. **BF-1.0** — the pre-commit boundary-check gate. No dependency, cheap, and it
   converts every subsequent Phase-1/UI packet's cross-slice discipline from "a worker
   might forget" into "the hook catches it." Land before Phase 1's promotions start in
   earnest.
3. **BF-0.4** 🔒 — the zip-handling security fix. Independent of BF-0.0's chain; must
   land before any public Tier A/C traffic, so there is no reason to wait.
4. **BF-1.3** — `StageProgressList` extraction. Independent, unblocks BF-5.3 later, and
   exercises the promotion pattern once before BF-1.1/BF-1.2/BF-1.4 follow the same shape.

**Backfill, as each of the four above merges (still ≤4 open at once):**

- BF-0.0 merges → open **BF-0.1**.
- BF-1.0 merges → open **BF-1.1** and **BF-1.4** (the remaining Phase-1 promotions;
  BF-1.2 waits on the D-B1 scout per §6.3 of the feature plan).
- BF-0.4 merges → open **BF-2.0** (no dependency; unblocks the whole of Phase 2).
- BF-1.3 merges → open **BF-3.1** (no dependency; the skeleton everything in Phase 3/4
  is scoped against).

From there the DAG fans out on its own: BF-0.1 → BF-0.2 → BF-0.3 continues its chain
one merge at a time; BF-2.0 unlocks BF-2.1/2.2/2.3 (3-wide, pick 3 of the 4 open slots);
BF-3.1 unlocks BF-3.2/3.3/3.4 and, once BF-2.1/BF-1.1/BF-1.4 are also in, Phase 4's
BF-4.1/4.2/4.4.

**The MVP milestone — call it out explicitly when it's reached, don't let it pass
quietly:** Phase 0 + Phase 1 + Phase 2 + Phase 3 + BF-6.1 + BF-6.2 merged is a shippable
product moment (artifacts in, report out, gate bundle downloaded) per the feature
plan's corrected MVP definition (§0 "The MVP is not Phase 3 alone"). Surface it to the
owner as a checkpoint, gated on **D-B3** before anything about it goes public.

**Do not provision until their gate resolves:** BF-5.1 (D-U1), BF-5.2 (D-P1, inherited
from the companion remaining-work arc's Wave S item S-4 — **this arc does not own
D-P1's resolution; that happens over there**), BF-6.3 (D-U3).

## 4. Per-phase delegation cards

### Phase 0 — Contract truth

BF-0.0 first (schema, no dependency). Then BF-0.1 — a **Domain/Contract Worker** who
writes both the `packages/sync` producer test and the `apps/web` consumer test named in
the packet's scope fence, not one combined test; the RED test must fail specifically
because `runScan` emits no envelope line today, not because some other line happens to
parse. BF-0.2 and BF-0.3 follow, each its own worktree from the just-merged `main`.
**Refuter panel on BF-0.3** — the packet plumbs an existing CLI contract
(`hexagen-lint --json`) through a code path that currently discards it via
`stdio: "inherit"`; the refuters' job is to confirm nothing else currently depends on
that stdio behavior being inherited. BF-0.4 runs in parallel, its own worktree,
**refuter panel mandatory** (🔒) — two RED tests, not one: the peak-byte-counter
assertion for the inflation fix, and the zero-bytes-on-disk assertion for the
duplicate-entry-name fix.

### Phase 1 — Neutral-home promotions

BF-1.0 first, standalone. Then BF-1.1, BF-1.3, BF-1.4 in parallel (independent files,
independent worktrees) — each is a genuine promotion (move, not copy) with the target
component's existing tests ported alongside it. **BF-1.2 needs the D-B1 scout first**
(feature-plan §6.4): confirm the exact consumer list before deciding whether it's a
pure `git mv` (the recommended default) or needs coordination with the companion
remaining-work arc's Wave D item 8.1, which touches the same hook. Do not provision
BF-1.2's worker until that scout reports back and the pure-move path is confirmed clear.
**Every Phase-1 worker's report must state, explicitly, that no baseline entry was
added to `CROSS_SLICE_ALIAS_BASELINE` or `NEUTRAL_FEATURE_BASELINE`** — those are
shrink-only ratchets and a promotion that needs one is a promotion done wrong.

### Phase 2 — Primitives

BF-2.0 is the entire point of the phase and must land before BF-2.1/2.2/2.3 write
anything: it is the packet that closes the enforcement gap the round-3/4 review found
(feature-plan §11 R-18). Its RED test is a fixture file with a forbidden prop name and
an arbitrary Tailwind value in `components/primitives/` — the gate must fail on it, then
the fixture is deleted in the same PR. Once BF-2.0 merges, BF-2.1/2.2/2.3 fan out fully
in parallel — greenfield files, no shared state, a **UI Worker** each.

### Phase 3 — Tier A vertical slice + Phase 6's BF-6.1/6.2 (the MVP set)

BF-3.1 first (the skeleton and state machine everything else in Phase 3/4 targets).
Once it merges: BF-3.2 (API route, needs BF-0.4 merged), BF-3.3 (screens, needs BF-3.1

- BF-2.2 + BF-1.1), and BF-3.4 (draft persistence, needs only BF-3.1) fan out in
  parallel. **BF-6.1 and BF-6.2 are scheduled here, not in Phase 6**, per the corrected
  MVP definition — BF-6.1 has no dependency and can start as soon as a slot is free;
  BF-6.2 follows once BF-6.1 and BF-2.2 are both in. **Scout BF-6.1 first** (feature-plan
  §6.4): every consumer of `hexagenConformanceActionFiles` before generalizing its
  signature — this function is shared with the ordinary (non-brownfield) project-export
  path, and a signature change that isn't scouted first risks breaking it silently.

### Phase 4 — Ratification

Starts once BF-3.1, BF-2.1, and BF-1.4 are all merged. BF-4.1, BF-4.2, and BF-4.4 own
disjoint sub-folders and fan out fully in parallel — three separate **UI Worker**
agents. **Scout BF-4.2 first**: confirm exporting `sanitizeScope` from
`packages/sync/src/commands/bootstrap/index.ts` doesn't collide with an existing name in
that package's public barrel. BF-4.3 (the bootstrap API route) only needs BF-4.2's
_type_, not its merge — it can be provisioned once BF-4.2's worker has reported the
final shape, even before BF-4.2 itself lands, since BF-4.3 depends on the type contract
alone (mark this explicitly in the Work Plan so the Primary doesn't block it needlessly).

### Phase 5 — GitHub entry + streaming — gated, do not provision early

**Do not provision any Phase-5 worker until D-U1 resolves.** BF-5.1 first (quota),
then BF-5.2 — **gated on D-P1, which this arc does not own** (it is the companion
remaining-work arc's item S-4; surface it, do not attempt to resolve it by building
around it) — **refuter panel mandatory** on BF-5.2, prompted specifically to refute the
clone-bounding claims (size preflight, tmpfs quota, wall-clock kill — the feature
plan's §11 R2-3 already records what was checked once; the refuters' job is to find
what wasn't). BF-5.3 (the UI) needs BF-5.2, BF-1.2, and BF-1.3 all merged — it is
realistically the last packet in this arc to start.

### Phase 6 — BF-6.3, BF-6.4 (BF-6.1/6.2 already covered under Phase 3 above)

**BF-6.3 🔒 — do not provision until D-U3 resolves.** When it does: a worker briefed
explicitly on the threat model from the feature plan's §4 prose (the `repo workflow`
scope is already granted and already used by `/api/export/github`; this packet adds a
new _use_, not a new grant, but it is still the first automated repo-write beyond the
existing publish flow), building behind a default-off `BROWNFIELD_GATE_PR` env flag,
with a **3-refuter panel** before landing. BF-6.4 is independent and small — schedule it
opportunistically in any open slot; its RED test is a byte-comparison between the
`sync-integrity-workflow.ts` constant and this repo's own dogfooded
`.github/actions/hexagen-conformance/post-comment.mjs` copy, which have already drifted.

### Phase 7 — Report + persistence

**Scout BF-7.1 first**: the `migrateSavedProjects` vs index-ordering constraint in
`platform-db.ts` (documented in that file: migrations run before the index-creation
block, and a new table needs to respect that ordering or risk creating an index against
a table that doesn't exist yet on a fresh DB). BF-7.2 needs BF-7.1 and BF-4.4 both merged.

---

## 5. Decision gates — stop and surface; never resolve for the human

| Gate     | Question                                             | Orchestrator behavior                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-P1** | Ship the `hexagen` CLI in the prod image             | **Not this arc's gate to resolve** — it is the companion remaining-work arc's item S-4. Surface that BF-5.2/5.3 are blocked on it and point at that arc; do not attempt to build around it here.                                          |
| **D-U1** | Anon public-clone quota policy                       | Surface with the plan's recommendation (new `"scan"` `QuotaKind` + per-IP limiter, not the frozen ADR-0063 files); wait.                                                                                                                  |
| **D-U2** | Tier B private-repo clone at all?                    | Surface; the plan's default is post-MVP with a label, which the plan itself already treats as the working assumption — confirm before BF-5.x work that touches private-repo paths specifically, not before BF-5.1/5.2's public-repo path. |
| **D-U3** | S7b OAuth PR despite all-repos scope optics?         | Surface with the recommendation (keep for self-owned repos, explicit warning, GitHub App is the real answer); wait. Do not provision BF-6.3 until resolved.                                                                               |
| **D-B1** | BF-1.2 vs companion arc's Wave D 8.1 sequencing      | Surface once with the recommendation (option a, pure move); may proceed under it after the scout confirms the consumer list is clean — this is an engineering sequencing call, not a product/security one.                                |
| **D-B2** | Do the Phase-2 primitives graduate to `@hexagen/ui`? | Not a blocker for any packet in this plan — proceed under "not now"; revisit only if a second app needs the primitives.                                                                                                                   |
| **D-B3** | Is the MVP public, or internal/preview-labelled?     | **True stop.** Does not block building Phases 0–3 + BF-6.1/6.2, but blocks releasing/announcing the MVP milestone from §3. Surface at the milestone, not before.                                                                          |
| **D-B4** | Does the gate zip carry a `package.json` patch?      | Already resolved in the plan (ship `HEXAGEN-GATE-INSTALL.md`, never auto-patch) — proceed under that recommendation; surface once so it's a recorded decision, not a silent default.                                                      |

## 6. Release-, deploy-, and merge-gated actions — never take them

- Never dispatch `deploy.yml` for the D-P1 image change — that action belongs to the
  companion remaining-work arc's owner-flagged S-4 deploy, not to this arc, even though
  this arc is what needs it.
- Never flip `BROWNFIELD_GITHUB_SCAN` or `BROWNFIELD_GATE_PR` on in a live environment
  without explicit go-ahead — they exist specifically so the code can merge before the
  product decision (D-U1/D-P1 for the first, D-U3 for the second) is finalized.
- Never push a `vX.Y.Z` tag, run `yarn bump`, or dispatch `publish.yml`. Nothing in this
  arc touches the published `@hexagen/sync` or `@hexagen/arch-linter` surface directly,
  but BF-0.1–0.3 and BF-4.2 touch files those packages ship from — verify with
  `node scripts/verify-publish-test-scope.js` (feature-plan §8), never with a release.
- Never merge a PR — merge is a human gate throughout; a named deputy may act.
- Never edit `generator.config.yaml`, `**/dist/**`, `yarn.lock`, `turbo.json` without
  explicit `--force-root` authorization.
- Never edit this repo's own `.architecture/**` — no packet in this arc needs to; if one
  appears to, stop and report before proceeding.
- Never commit the root `pr-comment-sweep.md` and never `git add -A` anywhere.

## 7. Global constraints

Identical to every other arc's: no AI attribution anywhere; neutral phrasing, no
personal names in PR text; named-path staging only; `git branch --show-current` before
every commit; squash-merge with explicit subject/body; reviewer's-guide comment on every
PR; pre-empt bot-flaggable patterns inline (this arc's own round-3/4 review already
demonstrates the pattern — check the feature plan's §11 ledger before writing a packet's
PR body, since several likely-to-be-re-raised issues are already pre-empted there);
never act on a bot's say-so, verify against the tree first; historical planning docs get
banners, never rewrites — if a packet's implementation reveals the feature plan itself
was wrong about something, correct the feature plan with a dated addendum, not a rewrite.

## 8. Worker governance block

Prepend the `[GLOBAL GOVERNANCE]` block from
`docs/planning/2026-08-14-architecture-remediation-implementation-prompt.md` §8
**verbatim** to every worker prompt, then the feature plan's own
**`[BROWNFIELD ARC ADDENDUM]`** (§6.1 of the feature plan — DESIGN.md binding, the
`@hexagen/ui/types` subpath trap, cross-slice import ban with the before/after-BF-1.0
pre-commit distinction, `apps/web/components/` naming, the 11 forbidden prop names, the
open-string rule-grouping requirement, test conventions), then append:

```text
# --- Brownfield implementation-prompt additions ---
- Your packet ID + scope fence + RED test come from
  docs/planning/2026-08-20-brownfield-ui-feature-plan.md §3/§4; quote your packet ID
  in the commit subject (e.g. "feat(web): BF-3.1 brownfield flow skeleton").
- If you are BF-0.0 or BF-0.1: you own TWO test files, one in packages/sync and one in
  apps/web. Report both explicitly. A report naming only one is incomplete.
- If your packet is marked with a lock icon in the feature plan (BF-0.4, BF-6.3): a
  refuter panel runs before this lands, no exceptions, regardless of how small the diff
  looks.
- Before touching any file, check the feature plan's §11 review-adjudication ledger for
  your packet's ID — several packets already have a documented "the reviewer said X,
  verification found Y" history. Do not re-litigate a refuted claim; do not re-discover
  an already-accepted one as if it were new.
- Report your diff, your test evidence (RED then GREEN output, both suites where two
  apply), and any scout-contradicting discovery back to the Primary; do not push,
  commit, or open PRs yourself.
```

## 9. Completion checklist (Primary tracks continuously)

- [ ] Every ungated packet merged; every gated packet (BF-5.1–5.3, BF-6.3) explicitly
      parked with a dated runbook note naming its gate.
- [ ] Quality Gate green on `main` after each landing; suite counts quoted in every
      landing record; Phase-0 landings additionally quote both suites' counts.
- [ ] Refuter panels ran on BF-0.3, BF-0.4, BF-5.2, BF-6.3; verdicts recorded in PR bodies.
- [ ] The four §6.4 scouts (BF-1.2, BF-4.2, BF-6.1, BF-7.1) ran and reported before
      their workers were provisioned, not after.
- [ ] No `CROSS_SLICE_ALIAS_BASELINE` or `NEUTRAL_FEATURE_BASELINE` entry added by any
      Phase-1 promotion.
- [ ] Execution runbook created on first landing and kept current at every merge, not
      batched at the end.
- [ ] The MVP milestone (Phase 0+1+2+3 + BF-6.1+6.2) reported to the owner the moment it
      is reached, with D-B3 surfaced alongside it.
- [ ] All decision gates surfaced in the first report and re-surfaced at every relevant
      packet boundary: D-P1 (pointed at the companion arc, not resolved here), D-U1,
      D-U2, D-U3, D-B1, D-B3, D-B4.
- [ ] Feature-flag defaults (`BROWNFIELD_GITHUB_SCAN`, `BROWNFIELD_GATE_PR`) confirmed
      off in every environment this arc's code reaches, until their gates resolve.
- [ ] Packet→feature traceability intact — each of F-01…F-37 lands in exactly the
      packet the feature plan's §3 assigns it; packet IDs unchanged from the plan.
