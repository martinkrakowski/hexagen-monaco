# Remaining work — implementation prompt (orchestrated, worktree + sub-agent)

**Date:** 2026-08-20 · **Status:** ready to run
**Baseline:** `origin/main` @ `4dddf1e1` (#558) — **fetch before provisioning anything; local checkouts may be behind.**
**Drives:** [`2026-08-20-remaining-work-plan.md`](./2026-08-20-remaining-work-plan.md) (authoritative item list, gates, acceptance) with [`2026-08-20-remaining-work-execution-runbook.md`](./2026-08-20-remaining-work-execution-runbook.md) as the live status ledger.

This file is the **execution wrapper** for the 2026-08-20 plan. Hand it to a fresh
Primary agent to run the plan end-to-end under Orchestrator Mode. It does not restate
the items — the plan's wave tables are the source of truth for _what_ each item is and
what "done" means. This prompt encodes _how_ the work is delegated into worktrees and
sub-agents, phased, gated, and landed — and _which choices must be made by a human first_.

---

## 0. Prime directive (paste as the orchestrator's operating brief)

> You are the **Lead Architect and Orchestrator** for the Hexagen-Monaco remaining-work
> arc. You operate in **Orchestrator Mode** per `AGENTS.md` and `.agents/ORCHESTRATOR.md`.
> **You write no implementation code.** You decompose plan items, emit Work Plans,
> delegate to sub-agents in isolated worktrees, run the Quality Gate, adjudicate review
> bots, keep the runbook's §1/§3/§7 current as items merge, and land PRs — respecting
> every dependency and decision gate below.
>
> Authoritative inputs, in precedence order:
>
> 1. `docs/planning/2026-08-20-remaining-work-plan.md` — items, gates, Manifest-edits
>    columns, finding→item index.
> 2. `docs/planning/2026-08-20-remaining-work-execution-runbook.md` — live status,
>    decision ledger, do-not-start list, Quality Gate, §5.1/§5.2 release procedures.
> 3. `.agents/ORCHESTRATOR.md` / `.agents/REVIEW.md` / `.agents/TESTING.md` /
>    `.agents/yaml-editing-disciplines.md` — process, adjudication, failing-first, YAML.
> 4. `docs/planning/2026-08-14-architecture-remediation-plan.md` — canonical finding
>    definitions (AUD/HEX/GOD/REA IDs) when an item's intent needs its original wording.
>
> When this prompt and the plan disagree on _what_ an item is, the plan wins; this
> prompt governs _process_. When any document disagrees with the tree, the tree wins —
> re-measure, update the runbook, then act.

---

## 1. Delegation model

Same roles as the 2026-08-14 prompt §1; restated because they are load-bearing:

| Role                       | Agent shape                                                | Used for                                                                          |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Scout**                  | `subagent_type: "explore"`, read-only, **no worktree**     | Liveness / zero-consumers / impact proofs; FU-1.2 re-measure; R-6 offender census |
| **Domain Worker**          | `subagent_type: "general"`, `isolation: worktree`          | 8.12(h)/(a), all of Wave D, R-2, R-4                                              |
| **Adapter/Tooling Worker** | `subagent_type: "general"`, `isolation: worktree`          | S-1, S-4 code, R-5, R-6, FU-1.3 batches, FU-1.4, Wave E items                     |
| **Test/QA Worker**         | `subagent_type: "general"` (may share the item's worktree) | Failing-first tests, contract tests, gate prep                                    |
| **Refuter panel**          | 2–3 parallel `subagent_type: "general"`, majority verdict  | Every Wave D PR; 8.12(h); any published-surface change                            |

Standing rules (do not relax):

- **One item = one worktree = one PR.** Provision with `isolation: worktree` per
  item; parallel items get parallel worktrees. Worktrees have **no `node_modules`** —
  workers stage diffs and report; the Primary runs gates from the main checkout.
- **Fan out independent items; serialize dependent ones.** A dependent item starts
  only when its prerequisite is **merged and green on `main`**. Independent items run
  as concurrent worker agents — launch them in the same turn, not sequentially.
- **Concurrency cap:** ≤4 open `wave-*`-labeled PRs at any time. Hotfixes are
  unlabeled and exempt. Do not spawn a comment-sweeper agent while a builder is running.
- **Scout before seam edits — as a sub-agent, before the worker exists.** Deletions
  (R-2, R-4's alias question, anything Wave D removes) need a zero-consumers proof
  (grep + typecheck) captured for the PR body. If the scout contradicts the plan's
  premise, **stop and surface; do not proceed.**
- **Primary-reserved stays reserved:** workers never edit `.architecture/**` or the
  context-YAML family, never run the gate of record, never `git commit`. Port-touching
  items here — **8.12(h), 8.12(a), 7.1, 7.6** — are worker-prepared, Primary-landed.
- **Effort tiering:** mechanical batches (FU-1.3, R-1, R-3) → low-effort workers;
  seam/protocol work (8.12(h), Wave D, FU-1.2) → standard workers + refuters.

## 2. Per-item execution loop

Run the 2026-08-14 prompt §2 loop verbatim for every item, with two amendments:

1. **Step 0 (new):** check the runbook §4 do-not-start list and §3 decision ledger.
   If the item is behind an unresolved gate, do not provision a worktree — surface the
   gate instead.
2. **Step 10 (new):** on merge, update the runbook — §1 status row, §2 item row,
   §7 change-log entry with the merge SHA and the quoted `yarn test` suite count.
   A merge that doesn't update the runbook is unfinished (this is how the 2026-08-18
   runbook went 17 merges stale).

The loop, condensed: decompose → scout (sub-agent) → Work Plan table → provision
worktree → delegate with the §6 governance block prepended → Primary lands
manifest-family edits → refuter panel where mandated → Quality Gate (Primary, from
main checkout) → land, adjudicate bots, reviewer's-guide comment → human merges.

## 3. Wave map, gating, and the opening fan-out

```text
Gates:  8.12(h) ⟶ 8.12(a)            8.12(h) ⟶ 7.1 ⟶ 7.2 ⟶ 7.3 ⟶ 7.5 ⟶ 7.6
                                      7.4 ‖ 7.3        7.1 ⟶ 8.1 ⟶ 8.2
        D-P1 ⟶ S-4     D-T11 ⟶ DOS-2.11     D-V* ⟶ T5.*     D-R1a ⟶ RI-1.2
        FU-1.3(b2) ⟶ FU-1.3(b3) ⟶ FU-1.4
```

**Opening fan-out (launch these four worker streams in parallel, day one):**

1. **8.12(h)** — Domain Worker + Test/QA in one worktree. The critical path; staff it first and best.
2. **S-1** — Tooling Worker in its own worktree (three RED tests, one PR).
3. **FU-1.3 batch 2** — Tooling Worker, 3–5 workspaces from the plan's list, #555 as the template PR.
4. **One Wave R item** — start with R-2 (scout first) or R-4; R-1 and R-3 are Primary-only doc/YAML edits needing **no worker at all** — the Primary lands them directly between reviews.

That is the full ≤4 cap. As each merges, backfill from: remaining Wave R items,
FU-1.3 batch 3, FU-1.2 (only when a slot is free for a _solo_ landing), then the
Wave D DAG as 8.12(h) → 7.1 unlocks.

**Surface to the owner immediately, in the first report (no PR substitutes):**
branch protection (overdue), D-P1/D-P2 (S-4 blocked), D-T11 write-up, D-R1a
(decidable now), D-V1–V4, the 6.7(a) `next` soak start, issues #510/#521/#428.

## 4. Per-wave delegation cards

### Wave B′ — critical path

- **8.12(h)** — treat as a **feature extraction**, not a file move. Scout first:
  enumerate every consumer of `GenerateWithAiScreenState` and the screen-flow symbols
  across `manifest-generation`, `apps/web`, and `model-settings`. Domain Worker moves
  code; Test/QA ports the suites; worker stages the `context.yaml` ownership diff as a
  proposal; **Primary applies it**. Refuter panel (2–3 agents) before landing: refute
  "no behavior change" against the generate-with-AI flow. Lands **alone** — nothing
  else in the PR.
- **8.12(a)** — small Domain Worker PR after (h) merges; port declaration moves with
  the code; Primary lands the manifest edit.
- **FU-1.2** — Scout runs the mandatory re-measure (throwaway tsconfig extending
  `apps/web/tsconfig.json`, record counts + top codes) **before** the worker is
  provisioned; the stale 110/29 figure must not size the PR. Worker fixes fallout with
  zero suppressions; Test/QA runs the web e2e target on the same SHA. Lands alone.

### Wave D — GOD-001 DAG · **refuter-mandatory on every PR**

One worktree per item, strictly in DAG order; 7.4 may run in a parallel worktree
alongside 7.3. Every PR: wire-compat verified against the `/stage` adapter **and** the
web classifier; re-exports kept one release; refuter panel prompted to show protocol
drift or a missed consumer. 7.6's side effects stay in infrastructure adapters behind
the new outbound port (worker stages the `mcp-server` `context.yaml` diff; Primary
lands). 8.1/8.2 are web workers, gated on 7.1 — never started early.

### Wave S — scan/adopt hardening

- **S-1** — one Tooling Worker, one worktree. Three failing-first tests (adopt
  dangling-symlink, bootstrap dry-run "Would write" lie, scan `pathExists` on a
  dangling manifest), then the `lstat`/ENOENT-only fixes. Record the D-P2 policy
  decision in the PR body.
- **S-4** — **do not provision until D-P1 is resolved.** Then: Tooling Worker for the
  Dockerfile/compose change only; verification plan in the PR body
  (`docker exec hexagen-web hexagen --version`). **The deploy itself is owner-triggered;
  never dispatch `deploy.yml`.**

### Wave R — residual polish

R-1 (ADR-0055 status) and R-3 (`driver_slice_exceptions`) are Primary-only edits —
no worker, no worktree beyond the PR branch. R-2 and R-4 get a Scout proof first,
then a small Domain Worker each. R-5 and R-6 are `tools/arch-linter` workers; R-6's
scout counts src-root offenders before the rule-vs-move choice; R-5 may introduce
baseline entries at rule birth (allowed) but growth stays machine-blocked after.

### Wave E — gated / batched

FU-1.3 batches: one worker per batch, sequential batches (each batch's fixes inform
the next). FU-1.4 after the last batch. T5.2–T5.5 / RI-1.2 / RI-2.3 / DOS-2.11:
**provision nothing until their gates resolve** — surfacing the gate is the work.
When D-T11 lands, DOS-2.11 is a feature-sized worker with the audit gate from the
write-up as its acceptance test, and it burns the final ratchet row in the same PR.

## 5. Decision gates — stop and surface; never resolve for the human

| Gate                          | Blocks                        | Orchestrator behavior                                                                                    |
| ----------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| D-P1 (CLI in prod image)      | S-4                           | Surface with the recommendation (yes); wait.                                                             |
| D-P2 (symlink policy)         | S-1 scope                     | Surface; S-1 may proceed on current policy, recording it.                                                |
| D-T11 (template pins + audit) | DOS-2.11                      | Surface that it is **unwritten**; never draft-and-self-accept. Drafting for the owner to review is fine. |
| D-V1…D-V4                     | T5.2–T5.5                     | Surface once, batched, with the plan's recommendations.                                                  |
| D-R1a                         | RI-1.2                        | Surface as decidable now (counts visible since #537).                                                    |
| D-R1 / D-E1 / D5              | RI-2.3 / 6.7(a) tag / nothing | Note; no action this arc without explicit resolution.                                                    |

## 6. Release-, deploy-, and merge-gated actions — never take them

- Never push a `vX.Y.Z` tag, run `yarn bump`, dispatch `publish.yml` or `deploy.yml`.
  The 6.7(a) `next` soak, the `latest` tag (D-E1), and the S-4 deploy are owner-only;
  runbook §5.1/§5.2 are the owner's procedures, not yours.
- Never merge a PR — merge is a human gate throughout; a named deputy may act.
- Never edit `generator.config.yaml`, `**/dist/**`, `yarn.lock`, `turbo.json` without
  explicit `--force-root` authorization; keep `packages/mcp-server/src/index.ts`
  zero-diff (standing turbo env-var trap).
- Never commit the root `pr-comment-sweep.md` (untracked by request) and never
  `git add -A` anywhere.

## 7. Global constraints

Identical to the 2026-08-14 prompt §7, all still binding: no AI attribution
anywhere; neutral phrasing, no personal names in PR text; named-path staging only;
`git branch --show-current` before every commit; squash-merge with explicit
subject/body; reviewer's-guide comment on every PR; pre-empt bot flags inline; never
act on a bot's say-so; historical planning docs get banners, never rewrites.

## 8. Worker governance block

Prepend the 2026-08-14 prompt's §8 `[GLOBAL GOVERNANCE]` block **verbatim** to every
worker prompt (ESM NodeNext `.js` extensions in `packages/sync/`, hexagonal import
rules, `Result` returns, no empty barrels, dependency-declaration rule, worktree-has-
no-node_modules, Primary-reserved boundaries, failing-first discipline), then append:

```
# --- 2026-08-20 additions ---
- Your item row + acceptance criteria come from docs/planning/2026-08-20-remaining-work-plan.md; quote your item ID in the commit subject.
- If you burn a ratchet-baseline entry, delete it in this same diff; never add one except R-5 at rule introduction.
- Report your diff, your test evidence (RED then GREEN output), and any scout-contradicting discovery back to the Primary; do not push, commit, or open PRs yourself.
```

## 9. Completion checklist (Primary tracks continuously)

- [ ] Every ungated plan item merged; every gated item explicitly parked with a dated runbook note naming its gate.
- [ ] Quality Gate green on `main` after each landing; suite counts quoted in every landing record.
- [ ] Refuter panels ran on 8.12(h) and every Wave D PR; verdicts recorded in PR bodies.
- [ ] Runbook §1/§2/§3/§7 current with the last merge — checked at every landing, not at the end.
- [ ] Ratchet baseline at 1 until DOS-2.11, then 0 (or 1-with-reason if R-5 introduced a new entry).
- [ ] All owner items surfaced in the first report and re-surfaced weekly: branch protection, D-P1/D-P2, D-T11, D-R1a, D-V1–V4, 6.7(a) soak, issues #510/#521/#428.
- [ ] Finding→item traceability intact — each remaining finding lands exactly once, item IDs unchanged.
