# Review Disposition — handling automated review-bot comments

**Status:** Accepted
**Context:** PRs in this repo are reviewed by **CodeRabbit** and **qodo** bots. Their comments are high-signal but can be stale (reviewed an earlier commit), misattributed (historical vs. current code), or proportionately deferrable. Disposition each one — never reflexively apply or dismiss.

---

## Problem

A bot comment asserts a cause and proposes a fix. Two failure modes follow from trusting it verbatim:

- **Apply blindly** → you "fix" code against an unverified or stale claim, sometimes re-breaking what an earlier commit just fixed.
- **Dismiss blindly** → you wave off a real bug because the bot's framing was slightly wrong.

Both are avoided by treating every comment as a claim to **verify against the current code**, then dispositioning it explicitly.

**Mode boundary.** Review & Archeology mode is **read-only** (`AGENTS.md` §Review & Archeology Mode — no edits, no code generation). Everything through the disposition stays read-only; **implementing** the accepted fixes is Develop mode, reached with `develop [feature]`.

---

## The Loop (per comment)

1. **Verify against the current code.** Read the actual lines the comment targets — and the relevant git history. Bots frequently flag against a stale commit or conflate historical-vs-current code. If a comment measures a doc/code against the wrong version, the "contradiction" can be an artifact of that mismatch, not a real defect.
2. **Pin the cause by reading, not editing.** Confirm a claimed bug by tracing the code path, its git history, and the existing tests/usage — review mode is read-only. Where only execution can settle it, the empirical reproduction is the **failing-first test** written at fix time (Develop mode), which proves the cause and then stays as the regression pin. Never disposition on a cause you haven't substantiated.
3. **Refute with in-repo evidence.** When you push back, cite `file:line` from the repo's own working usage (what a helper actually reads, what a rule actually emits). Prefer that over version-ambiguous external docs.
4. **Classify severity.** Separate **Blocker** (silent data loss, wrong output, security, a shipped regression) from **Advisory / Backlog** (valid but proportionate to defer). State which, and why a deferral is proportionate + where it's tracked.
5. **Disposition explicitly.** Mark each comment **valid / partially valid / refuted**, each with the verified reason, and post the disposition as a PR comment.

---

## Honesty Rules

- Assert only **reproduced or verified** behavior — never an unverified cause.
- A refutation must carry its `file:line` evidence; a deferral must name where it's tracked.
- Distinguish "the bot's premise is right but its target is wrong" from "the bot is wrong" — they disposition differently.
- **Pre-empt** predictable flags: when you write a correct-but-flaggable pattern, leave a short comment explaining it so the next bot round doesn't re-raise it.

---

## Handoff to Develop Mode

The disposition is review mode's deliverable. **Implementing** the accepted fixes is **Develop mode** — switch with `develop [feature]` (Review & Archeology mode ends on exactly this hand-off; full spec `.agents/TESTING.md`). There:

1. Write the **failing-first test** before the fix — it must fail on the old behavior and pass on the new. It is both the empirical reproduction of the bug and its regression pin (a fix without one is unproven).
2. Re-run the gate (`yarn build && yarn typecheck && yarn lint`, then `yarn test`); note the suite count.
3. Commit per Develop mode (never push without explicit instruction), then post a **reviewer's-guide** summary on the PR: what changed, what was refuted, what was deferred.

Do not merge on a bot's say-so — merge is a human gate.
