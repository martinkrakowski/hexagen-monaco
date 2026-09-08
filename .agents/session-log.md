# Session log — wave records

One record per delegated wave, appended in order, newest last. A wave is not finished when its
pull requests merge; it is finished when its record is committed here.

This file is **append-only**. `scripts/merge-prs.sh` lists it in `APPEND_ONLY`, so when two lanes
of the same wave both append, the merge resolver keeps both sides instead of aborting. Never
rewrite or reorder an existing record — correct one by appending a later entry that says what
changed and why.

## Which spec governs what

Two orchestration specs apply to this repository, and they are not rivals:

| Spec                               | Governs                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.agents/ORCHESTRATOR.md`          | **How work is decomposed and governed** — bounded-context and layer analysis, the work-plan table, governance constraints injected into every sub-agent prompt, the quality gate, sub-agent roles.                       |
| `.claude/skills/orchestrate-wave/` | **How one lane becomes a merged pull request** — worktree and branch per lane, brief authoring, dispatch to an external implementer CLI, two-model review, remediation, thread sweep, sequential merge, and this record. |

Where they overlap, `ORCHESTRATOR.md` decides _what the lanes are_ and `orchestrate-wave` decides
_how each lane is run_. The ported skill is not checked in (`.claude/` is gitignored); the
orchestrator copies it into each lane worktree.

## What a record contains

What merged, with its squash commits · what was refuted **and why** · what the review layer
actually bought · any defect found in the _plan_ rather than the code · runs per seat, so a quota
burn is visible before the quota is · what stays deferred.

---
