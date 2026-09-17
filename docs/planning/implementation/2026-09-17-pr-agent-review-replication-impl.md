# Replicating the PR-Agent Reviewers — Implementation Plan

**Date:** 2026-09-17
**Source plan:** `docs/planning/pr-agent-review-replication.md` (PR #678)
**Status:** ready to dispatch — the closest of the four to implementable
**Verified against:** `main` at `732e9591`
**Review:** Fable and grok-4.6 independently; both rate this the live plan for this repo's bots.

---

## 0. What the review changed

The source plan's factual claims about this repository **all check out**, which is rare enough to
state plainly:

| Claim                                                                        | Verdict     | Evidence                                                      |
| ---------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| Neither `patch_extra_lines_before` nor `patch_extra_lines_after` is set      | ✅ verified | `grep` over `.pr_agent.toml` and `pr-agent.yml` → no matches  |
| `pr-agent.yml` pins a docker digest of `0.42.0`, not the rolling tag         | ✅ verified | `:13-15`, `:172` `docker://pragent/pr-agent@sha256:b81235c3…` |
| Concurrency is keyed by PR × produces-a-review × sender type                 | ✅ verified | `:92-102`, with the `#594/#595/#609` incident recorded inline |
| One PR-Agent workflow here, three in campaign-foundry                        | ✅ verified | `ls .github/workflows/`                                       |
| The toml is ~16 KB with an `[ignore]` block and a context-budget calculation | ✅ verified | 16329 bytes; `[ignore]` at `:217`; arithmetic at `:57-72`     |

**Three amendments, each found by one reviewer and verified by the orchestrator:**

1. **R4/R5 are blocked by the shared `[ignore]` regex.** `.pr_agent.toml:242` keeps only
   `apps/web/` plus three contract files and drops everything else — and the toml is read from the
   **default branch** (`yml:6-9`). A template-engine or sync-engine reviewer reading it sees an
   empty diff on every PR it runs for and posts nothing. **Each new workflow must override
   `[ignore]` in its own env.** The source plan does not say so.
2. **R2 is an edit, not a blank page.** P-D2 ("a finding must carry a mechanism, not a
   suggestion") is _already partly implemented_ at `pr-agent.yml:234-237`. Amend those
   instructions rather than writing new ones.
3. **R1's DoD targets the wrong failure class for this repo.** It is written for
   campaign-foundry's "symbol X is undefined" class. This repo's own config documents _different_
   failures: pruning (`toml:39-46`), ticket analysis (`toml:102-108`), off-remit findings
   (`toml:220-224`), failed-to-generate (`yml:336-339`). R1 could pass trivially here and move
   nothing. **Re-anchor the DoD to a failure this repo has actually recorded.**

**Both reviewers flagged the 18-to-1 table as unverifiable from this repository** — the data is
campaign-foundry's, and the sibling gates plan cites ≈1-in-10 for the same reviewer family from a
different wave. Neither number is needed for the decisions. **Label the table as one downstream
night, cite the wave record, and keep P-D6's 20 % stopping rule** — which does not depend on the
exact ratio.

---

## 1. Work Plan Table

| #   | Task                                                                                  | Sub-Agent      | Scope (Package · Layer) | Mode         | Tag        | Depends On |
| --- | ------------------------------------------------------------------------------------- | -------------- | ----------------------- | ------------ | ---------- | ---------- |
| 1   | Verify 0.42.0 honours `patch_extra_lines_*` and `allow_dynamic_context`               | Primary        | `.pr_agent.toml`        | 🔍 Review    | **GATE**   | —          |
| 2   | Set the context keys; re-anchor the DoD to a locally recorded failure                 | Primary        | `.pr_agent.toml`        | 🏗️ Architect | SEQUENTIAL | 1          |
| 3   | Amend `extra_instructions`: mechanism-not-suggestion, and check-the-code-not-the-note | Primary        | `pr-agent.yml:234-237`  | 🏗️ Architect | SEQUENTIAL | 2          |
| 4   | Turn off style/naming/preference classes                                              | Primary        | `.pr_agent.toml`        | 🏗️ Architect | PARALLEL   | 2          |
| 5   | Measure: one wave, threads raised vs verified-real, per bot                           | Primary        | wave record             | 🔍 Review    | **GATE**   | 2, 3, 4    |
| 6   | Second reviewer: template-engine invariants, **with its own `[ignore]`**              | Adapter Worker | `.github/workflows/`    | 🔨 Develop   | SEQUENTIAL | 5          |
| 7   | Third reviewer: sync-engine contracts, **with its own `[ignore]`**                    | Adapter Worker | `.github/workflows/`    | 🔨 Develop   | SEQUENTIAL | 5          |

**Why 5 is a `GATE`:** the plan's own thesis is that copying an unfixed reviewer multiplies noise.
Adding reviewers 2 and 3 before measuring whether the fix worked repeats the mistake the plan was
written to prevent. **One wave of measurement is the gate.**

Tasks 1–4 are Primary-reserved: they edit reviewer configuration, which is a governance surface,
and `.agents/ORCHESTRATOR.md` reserves config-of-record edits to Primary.

---

## 2. Global Governance

The standard block (see the gates implementation plan §2), plus:

```
- .pr_agent.toml is read from the DEFAULT BRANCH (pr-agent.yml:6-9). A change to it does not
  take effect on the PR that makes the change. Verify on the PR after it merges.
- The [ignore] regex at :242 keeps only apps/web plus three contract files. Any new reviewer
  that must see other paths MUST override [ignore] in its own workflow env, or it will review
  an empty diff and post nothing.
- Do not downgrade the docker digest pin to `the-pr-agent/pr-agent@<sha>`: :13-15 records that
  that action's Dockerfile FROMs the rolling tag, which defeats pinning.
- Do not regroup concurrency by PR alone: :30-102 records that doing so cancelled the review on
  #594, #595 and #609.
```

---

## 3. The measurement gate (task 5)

P-D6 says count permanently. Make it mechanical:

- Every wave record states, per bot: **threads raised · verified real · unique**.
- A reviewer whose verified-real ratio stays under ~20 % across two waves is **turned off**, not
  tuned again.
- The count is the orchestrator's, taken at sweep time, when every thread has been dispositioned
  anyway.

This arc already produced the data shape: on the findings-store lanes, Qodo and CodeRabbit each
found real defects the model reviewer missed and vice versa, and **two reviewers converged
independently on the F-D4 path-prefix hole** — which is the argument for more than one reviewer,
and equally the argument for measuring each.

---

## 4. Definition of Done

Step 5 checklist applies. Additionally, per lane:

- **Task 2:** a PR whose diff touches a symbol defined 60+ lines outside the hunk no longer draws a
  "symbol is undefined" finding — demonstrated on a real PR after the config merges to the default
  branch, since the toml is read from there.
- **Task 3:** a finding without a named failing input is withheld. Shown-to-fail: a deliberately
  vague prompt produces no thread.
- **Tasks 6, 7:** each new reviewer posts at least one thread on a PR touching **its** axis, and
  **none** on a PR touching only `apps/web`. That second half is the `[ignore]` override proof —
  without it the reviewer is silent everywhere and looks configured.
- **Task 5:** the wave record carries the per-bot table. A wave without it has not closed.
