# PR-Agent Super-Bot — SUPERSEDED, do not implement

**Date:** 2026-09-17
**Source plan:** `docs/planning/pr-agent-super-bot.md` (PR #678)
**Status:** ❌ **superseded by the shipped implementation.** No implementation plan follows.
**Superseded by:** `.github/workflows/pr-agent.yml` + `.pr_agent.toml` on `main`, and
`docs/planning/pr-agent-review-replication.md` for anything still open.

---

## Why there is no plan here

Both plan reviewers, independently, rated this document a **blocker** — meaning it cannot be built
as written. Not because it is wrong in the abstract, but because **the bot it proposes already
shipped, and then every one of its specifics was deliberately changed.** The live config records
the reason for each change inline.

| §3 / §2 proposes                                | Live on `main`                                                              | Why it changed                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `uses: the-pr-agent/pr-agent@<SHA>`             | `docker://pragent/pr-agent@sha256:b81235c3…` (`yml:172`)                    | `yml:13-15`: that action's Dockerfile `FROM`s the **rolling tag**, so pinning its SHA pins nothing     |
| model `openrouter/tencent/hy3`                  | `openrouter/inception/mercury-2` (`toml:8`)                                 | `yml:156-157`: hy3 **superseded by** mercury-2                                                         |
| fallback `claude-3.5-sonnet`                    | `claude-haiku-4.5` (`toml:20`)                                              | `toml:9-13`: claude-3.5-sonnet **does not exist in the OpenRouter catalogue** — the fallback would 404 |
| `custom_model_max_tokens = 64000`               | `128000` (`toml:33`), `max_model_tokens = 70000` (`toml:72`)                | the 64000 cap **pruned diffs** — recorded against #598                                                 |
| `auto_review: true`, `auto_improve: false`      | `auto_review false`, `auto_improve true` (`toml:221-223`)                   | reason at `toml:215-220`                                                                               |
| concurrency grouped by PR, `cancel-in-progress` | PR × produces-a-review × sender type (`yml:92-102`)                         | `yml:30-102`: PR-only grouping **cancelled the review** on #594, #595 and #609                         |
| ignore `.architecture/**`, `templates/**`       | `toml:240-241` explicitly says **do not** ignore those for any other reason | the `[ignore]` scope is deliberate                                                                     |

**Building §2–§3 as written would regress a production reviewer** into the exact `cancel-in-progress`
bug the current file's comments exist to prevent, with a fallback model that 404s and a token cap
that already pruned a diff once.

§5 ("Required Companion Document Updates") is **already done**: `.agents/REVIEW.md:4` lists
PR-Agent, `.agents/README.md` describes `PR_REVIEW_RUBRIC.md` as bot-facing, `.github/workflows/README.md`
documents the workflow, and `AGENTS.md:171` points at `REVIEW.md`.

---

## The documentation defect worth fixing

This document carries **no date and no status line**, and it was committed in the same commit as
`pr-agent-review-replication.md` (`5cffc3ad`) — which calls the existing reviewer _"well-built and
worth keeping"_. **Two documents in one commit give opposite instructions about the same bot, and
neither says which is current.**

That is the same failure mode as the AUD-020 trap the sibling plan records in P-D3: a stale
document read as current, cited as authority, producing a confident wrong decision. It has already
cost this repository one refuted review finding.

**Action:** stamp `pr-agent-super-bot.md` with a status line pointing at the shipped config and at
`pr-agent-review-replication.md`, or delete it. Every planning document in
`docs/planning/` should carry a **Date** and a **Status**; this one is the argument for making that
a convention rather than a habit.
