# Review Disposition — handling automated review-bot comments

**Status:** Accepted
**Context:** PRs in this repo are reviewed by **CodeRabbit** and **qodo** bots. Their comments are high-signal but can be stale (reviewed an earlier commit), misattributed (historical vs. current code), or proportionately deferrable. Disposition each one — never reflexively apply or dismiss.

---

## Problem

A bot comment asserts a cause and proposes a fix. Two failure modes follow from trusting it verbatim:

- **Apply blindly** → you "fix" code against an unverified or stale claim, sometimes re-breaking what an earlier commit just fixed.
- **Dismiss blindly** → you wave off a real bug because the bot's framing was slightly wrong.

Both are avoided by treating every comment as a claim to **verify against the current code**, then dispositioning it explicitly.

---

## The Loop (per comment)

1. **Verify against the current code.** Read the actual lines the comment targets — and the relevant git history. Bots frequently flag against a stale commit or conflate historical-vs-current code. If a comment measures a doc/code against the wrong version, the "contradiction" can be an artifact of that mismatch, not a real defect.
2. **Reproduce before you fix.** For a claimed bug, write a throwaway probe that exercises the _real_ exported function with the _real_ inputs, confirm the failure, then delete the probe. Never change behavior on a cause you have not reproduced.
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

## After Dispositioning

1. Implement the valid fixes with a test that **pins the change** — it must fail on the old behavior and pass on the new (a fix without a regression test is unproven).
2. Re-run the gate (`yarn build && yarn typecheck && yarn lint`, then `yarn test`). Note the suite count.
3. Post a **reviewer's-guide** summary on the PR (in addition to the per-comment dispositions): what changed, what was refuted, what was deferred.
4. Do not merge on a bot's say-so — merge is a human gate.
