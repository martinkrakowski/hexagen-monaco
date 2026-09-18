# Replicating the PR-Agent Reviewers — Implementation Plan

**Date:** 2026-09-08
**Author:** orchestrator (campaign-foundry), from one night's measured review data
**Status:** draft — for the owner's review. Nothing built.
**Verified against:** hexagen-monaco `main`, campaign-foundry `8c0e4ac`
**Scope:** port campaign-foundry's second and third PR-Agent reviewers here, and fix the defect
that makes the first one produce mostly noise.

---

## 0. What this plan answers, and the number it starts from

campaign-foundry runs **three** PR-Agent reviewers (`pr-agent.yml` UI, `pr-agent-api.yml`,
`pr-agent-arch.yml`). hexagen-monaco runs **one** (`pr-agent.yml`, UI). The obvious task is to copy
the other two.

**Do not do that yet.** Six pull requests were reviewed on campaign-foundry on 2026-09-08 with every
finding verified against the code by a human-directed orchestrator. The result:

| Reviewer                 | Threads raised | Verified real | Unique (not also found by another bot) |
| ------------------------ | -------------- | ------------- | -------------------------------------- |
| **PR-Agent** (all three) | **18**         | **1**         | **0**                                  |
| Qodo                     | 13             | 7             | 5                                      |
| CodeRabbit               | 5              | 3             | 2                                      |

PR-Agent's single true finding on #268 was raised independently by both Qodo and CodeRabbit the
same hour. **Copying that configuration to a second repository copies an 18-to-1 noise generator.**
The plan is therefore: fix it, prove the fix on the reviewer already here, and only then add the
other two.

---

## 0.1 Proposed decisions

| id       | Decision                                                                                                                                                                                                                                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P-D1** | **The dominant failure is context starvation, and it is one config key.** Neither repo sets `patch_extra_lines_before` / `patch_extra_lines_after`, so a reviewer sees a hunk with roughly three lines around it and **no view of the rest of the file**. Raise them substantially (start at 40/20) and enable dynamic context if the pinned 0.42.0 supports it.                                                  | Every false finding on #263 has this one cause: _"`isPlainObject` is undefined"_ (defined at `load-brief.ts:92`, hunk at `:160`), _"`isFiniteInteger` is undefined"_ (`:96`), _"add a `null` guard"_ (`isPlainObject` performs it at `:93`), _"`delete rest.template` before the spread"_ (already at `:800`, hunk showed `:801`). **A reviewer that cannot see the file cannot tell absent from out-of-hunk**, and it resolves that ambiguity by inventing a defect. |
| **P-D2** | **A finding must carry a mechanism, not a suggestion.** Instruct every reviewer: state the input or state that produces the wrong output, and name the line that would have to change. A finding that cannot name a failing case is withheld.                                                                                                                                                                     | Of 18 PR-Agent threads, 14 were phrased _"Suggestion: consider adding…"_. None named an input. The two reviewers that earned their keep both led with a mechanism — Qodo's _"`prepare` sets `logoApplied` when the file loads, while the draw loop paints it only if the list contains a logo"_ is checkable in one read; _"consider guarding"_ is not.                                                                                                               |
| **P-D3** | **Check the code, never the note about the code.** Instruct reviewers that a repository's own docs, ADRs and audit items are **claims with a date**, not evidence, and that a claim about what CI runs must be verified against the workflow file.                                                                                                                                                                | On hexagen-monaco's #670, `hy4-preview` **and** Qodo independently argued a change was safe by citing an audit item recording that a CI step ran nowhere — when that item was the _problem statement_ the step had since been added to fix. Two models made the same error from the same stale text. A reviewer quoting the repo reads as authoritative in a way a bare assertion does not.                                                                           |
| **P-D4** | **No style, naming or preference classes.** Turn suggestion categories that cannot fail down to zero; keep correctness, security and contract violations.                                                                                                                                                                                                                                                         | The verification budget here spends no fix rounds on nits, so a nit that reaches a thread costs a sweep and buys nothing. Two of PR-Agent's 18 were style-only and still had to be read, verified and answered.                                                                                                                                                                                                                                                       |
| **P-D5** | **Each reviewer is specialised to an axis this repo actually has**, not to campaign-foundry's. Its three are UI-contract, API-contract and architecture. Here the axes are **template-engine invariants** (the guarded `templates/` directory, `discoverTemplateIds`, manifest shape), **sync-engine contracts** (emit shape, `--force-root` protected files, generator parity) and the existing **UI contract**. | A reviewer told to enforce `DESIGN.md` §-numbers in a repository whose design document is different will produce confident, well-cited nonsense. The specialisation is the point of running three rather than one louder one.                                                                                                                                                                                                                                         |
| **P-D6** | **Count the hit rate, permanently.** Every wave record states threads raised and verified-real per bot. A reviewer whose ratio stays under ~20 % over two waves is turned off, not tuned again.                                                                                                                                                                                                                   | This plan exists because someone counted. Without the count, 18-to-1 reads as "the bots are noisy lately" and nobody acts.                                                                                                                                                                                                                                                                                                                                            |

---

## 1. Findings

#### **F1 · C · The reviewer is reviewing a hunk and reporting on a file**

`grep -n "patch_extra_lines\|allow_dynamic_context" .pr_agent.toml` returns nothing in **either**
repository, so both run PR-Agent 0.42.0's defaults. Four of six false findings on one PR are
"symbol X does not exist" where X is defined 60–700 lines away in the same file. This is not a model
quality problem and no amount of `extra_instructions` fixes it.

#### **F2 · H · hexagen-monaco's existing reviewer is well-built and worth keeping**

`pr-agent.yml` here already pins the **multi-arch index digest** of `0.42.0-github_action` rather
than the rolling tag, documents that `repo_context_from_default_branch = false` reads the PR
_target_ and not the head, and states in its own header that a green check is not a review. Its
16 KB `.pr_agent.toml` carries an `[ignore]` block and a context-budget calculation. **Port the
missing reviewers into this structure; do not replace it with campaign-foundry's.**

#### **F3 · M · Three reviewers on one PR is a sweep cost, not just a compute cost**

Each thread must be verified against the code, answered with its mechanism, and resolved — by a
human or an orchestrator, not a bot. 18 threads at ~2 minutes of verification each is over half an
hour per wave spent proving that findings are false. **The cost of a bad reviewer is paid in
attention, which is why P-D6 exists.**

#### **F4 · M · The two repos' review layers are not interchangeable**

campaign-foundry's reviewers cite `DESIGN.md` sections and `D`-numbered decisions from
`docs/planning/`. This repository's decisions live in `.architecture/decisions/` as ADRs, its
invariants in `.architecture/invariants/`, and its planning documents are slug-named without
D-numbers. **Every instruction block must be rewritten against this repository's own vocabulary**,
which is most of the work in R2.

---

## 2. Lanes

| Lane   | Task                                                                                                                                                                                                                                                                                                                                                                        | Owns                                                       | Buys                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| **R1** | **Fix the context starvation** (P-D1). Set `patch_extra_lines_before = 40`, `patch_extra_lines_after = 20` in `[config]`; enable `allow_dynamic_context` if 0.42.0 supports it — **verify the key names against the pinned digest, do not trust this plan's spelling**. Re-run the existing UI reviewer over three already-merged PRs whose findings are known and compare. | `.pr_agent.toml`                                           | The one change that could move 18-to-1        |
| **R2** | **Rewrite the instruction block** (P-D2, P-D3, P-D4, P-D5) for the existing UI reviewer, against **this** repo's vocabulary: ADR ids, `.architecture/invariants/`, `AGENTS.md`'s protected-file list. Require a mechanism per finding; forbid style classes; state that docs are dated claims.                                                                              | `.pr_agent.toml` `[pr_reviewer]` + `[pr_code_suggestions]` | A reviewer that argues rather than suggests   |
| **R3** | **Measure, before adding anything** (P-D6). Run R1+R2 across one full wave. Record threads raised and verified-real per bot in the wave record. **Gate: if PR-Agent's ratio is still under 20 %, stop — do not add reviewers two and three.**                                                                                                                               | the wave record                                            | The evidence that decides R4                  |
| **R4** | **Add the second reviewer: template-engine invariants.** Its own workflow keyed like the existing one, its own env block, its own instruction set: the `templates/` guard (`discoverTemplateIds` strays), manifest shape, the verbatim `dist/templates` copy, what may and may not be emitted into a generated project.                                                     | new `.github/workflows/pr-agent-templates.yml`             | The axis this repo's defects actually live on |
| **R5** | **Add the third: sync-engine contracts.** Emit shape, protected files and `--force-root`, generator parity, the three-state config contract from the findings-store work.                                                                                                                                                                                                   | new `.github/workflows/pr-agent-sync.yml`                  | Coverage of the other half                    |

**Order.** R1 → R2 → R3 → **gate** → R4 → R5.

---

## 3. Definition of Done

- **R1**: the three replayed PRs produce **no** "symbol X does not exist" finding where X is defined
  in the same file. That class is the measurable target; if it survives, the key names are wrong or
  0.42.0 ignores them, and the lane reports that rather than proceeding.
- **R2**: every emitted finding names an input or state and a line. A finding phrased _"consider…"_
  with no failing case is a lane defect, caught by reading the first wave's threads.
- **R3**: the wave record carries a per-bot table. **No reviewer is added while PR-Agent is under
  20 %.**
- **R4/R5**: each new reviewer's first wave is measured the same way, and each is judged on unique
  findings — a reviewer that only echoes CodeRabbit and Qodo is a cost with no yield.

---

## 4. What this plan refuses

- **It does not copy campaign-foundry's three workflows as they stand.** Their measured yield here
  would be an 18-to-1 noise generator with the wrong vocabulary.
- **It does not treat a green PR-Agent check as a review.** hexagen-monaco's own workflow header
  already says so; that stays.
- **It does not tune a reviewer twice.** P-D6 is a stopping rule: two waves under threshold and it
  is turned off. A review layer that has to be argued into usefulness is not useful.
- **It does not assume the config keys.** Every key in R1 is to be verified against the pinned
  0.42.0 digest before it is written — this repository's own recurring failure is a confident
  reference to something that does not exist.
