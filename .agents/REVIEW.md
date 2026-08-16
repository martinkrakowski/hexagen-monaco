# Review Disposition — handling automated review-bot comments

**Status:** Accepted
**Context:** PRs in this repo are reviewed by automated review bots — **CodeRabbit**, **qodo** and **greptile-apps** at the time of writing. This loop applies to **whichever bots are configured on the PR**; that list is current practice, not a closed set, so a newly added bot is in scope on arrival (the one-line pointer at `AGENTS.md:152` names only the two longest-standing ones and is not the roster). Their comments are high-signal but can be stale (reviewed an earlier commit), misattributed (historical vs. current code), or proportionately deferrable. Disposition each one — never reflexively apply or dismiss.

---

## Problem

A bot comment asserts a cause and proposes a fix. Three failure modes follow from trusting it verbatim:

- **Apply blindly** → you "fix" code against an unverified or stale claim, sometimes re-breaking what an earlier commit just fixed.
- **Dismiss blindly** → you wave off a real bug because the bot's framing was slightly wrong.
- **Apply the bot's _fix_ blindly** → the finding was real, the proposed remedy was not, and you ship a worse defect wearing a resolved thread.

All three are avoided by treating both the **claim** and the **remedy** as things to verify against the current code, then dispositioning explicitly.

**Mode boundary.** Review & Archeology mode is **read-only** (`AGENTS.md` §Review & Archeology Mode — no edits, no code generation). Everything through the disposition stays read-only; **implementing** the accepted fixes is Develop mode, reached with `develop [feature]`.

---

## The Loop (per comment)

1. **Verify the claim against the current code.** Read the actual lines the comment targets — and the relevant git history. Bots frequently flag against a stale commit or conflate historical-vs-current code. If a comment measures a doc/code against the wrong version, the "contradiction" can be an artifact of that mismatch, not a real defect.

2. **Pin the cause by reading, not editing.** Confirm a claimed bug by tracing the code path, its git history, and the existing tests/usage — review mode is read-only. Where only execution can settle it, the empirical reproduction is the **failing-first test** written at fix time (Develop mode), which proves the cause and then stays as the regression pin. Never disposition on a cause you haven't substantiated.

3. **Verify the cited rule.** When a comment invokes a repo convention, check it against the source before complying. Bots infer conventions from surrounding code and get them wrong. Worked example: both CodeRabbit and qodo have flagged mixed `expect()` / `assert.*` as a violation — but there is no such rule to violate. **ADR-0044 Decision item 2** reads _"`expect()` is permitted in Vitest files"_ with existing `node:assert/strict` assertions _"retained"_, and `AGENTS.md:38` records both as "both fine; `assert.*` is retained codebase-wide". **Decision item 3** is labelled a **per-runner** rule — _"a Vitest file may use `expect()` or `assert.*`; new tests should prefer `expect()`"_ — which is a **permission, not an exclusivity constraint**: it does not forbid mixing the two styles within one file, and nothing else in the ADR does either (its Consequences call the coexistence of two assertion styles an accepted cost). The only binding part is the preference for `expect()` in **new** tests. Fix the underlying inconsistency if there is one, and correct the rule citation in the same reply.

4. **Verify the proposed remedy, separately from the claim.** A valid finding can carry an invalid fix. Before applying, ask what the suggested change does to inputs the current code already handles — **especially whether it converts a loud failure into a quiet one**. Applying a bad fix to a real bug is worse than leaving the bug, because it looks resolved. Real cases from this repo:
   - Replacing an index-manifest check with `every()` would have returned hollow pointer stubs, **silently green**, where the existing code throws.
   - Routing a manifest guard through the production loader would have rewritten its question from _"does a real `context.yaml` provide this key?"_ into _"does the Zod schema allow it?"_ — reinstating the exact defect the guard exists to catch.
   - A suggested fallback for a missing type literal would have **silently rewritten a valid `generic` bounded context to `supporting`** before it reached the model.

   If the remedy is wrong, say so explicitly: _the finding is valid, the proposed fix is not, here is what it would have done._

5. **Refute with in-repo evidence.** When you push back, cite `file:line` from the repo's own working usage (what a helper actually reads, what a rule actually emits). Prefer that over version-ambiguous external docs.

6. **Look for the class, not the reported instance.** Bots report one occurrence. Before fixing, grep for the same shape across sibling packages, the other spelling (relative vs. `@/` alias), and the other direction. Chasing the shape rather than the line is what turns one fix into a closed class — an alias-form import escape hatch also had a barrel re-export behind it; a namespace-import parser hole also had a parenthesised-parameter twin; a workspace missing `typecheck:test` in one workflow was missing it in another. Fix at the seam where the class cannot recur; if you fix only the instance, **say so and name the others**.

7. **Classify severity** into three tiers: **Blocker** (silent data loss, wrong output, security, a shipped regression), **Verifier defect** (below), and **Advisory / Backlog** (valid but proportionate to defer). State which, and why a deferral is proportionate + where it's tracked.

   **Verifier defects are their own tier.** _Criteria:_ the flagged code is itself a check — a guard, a lint rule, a CI script, a schema. For those, _"no live case in this package today"_ is a far weaker refutation than it is for production code. Production code with no live case does nothing; **a verifier with a blind spot under-reports silently, forever, and is trusted while doing it.** _Default disposition:_ **fix the parser/matcher** rather than prove the current tree happens to be clean. _Relation to the other two tiers:_ it is a **Blocker** whenever the blind spot can hide a live instance of the defect class the check exists to catch; otherwise it may drop to Advisory / Backlog, but only on the Advisory terms above **plus** a named, tracked hole. If you do refute on "no live case", state that the hole remains and name it.

8. **Disposition explicitly.** Mark each comment **valid / partially valid / refuted**, each with the verified reason, and post the disposition as a PR comment.

   **When a finding is valid but its stated consequence is overstated, correct it in the same reply.** "Blocks releases" versus "fails closed, but is discovered mid-release under pressure that invites `continue-on-error`" changes what someone does about it. Under-claiming a consequence misleads as much as over-claiming a defect.

   **Adjudicate duplicates once, reply and resolve individually.** Multiple bots routinely file the same defect from different angles — and sometimes argue _opposite_ remedies for it. Settle the substance once, say which threads duplicate which, and still reply to and resolve each thread.

---

## Honesty Rules

- Assert only **reproduced or verified** behavior — never an unverified cause.
- A refutation must carry its `file:line` evidence; a deferral must name where it's tracked.
- Distinguish "the bot's premise is right but its target is wrong" from "the bot is wrong" — they disposition differently.
- **Pre-empt** predictable flags: when you write a correct-but-flaggable pattern, leave a short comment explaining it so the next bot round doesn't re-raise it.
- **A passing bot check is not evidence that a review happened.** CodeRabbit reports `Review rate limited` and still reports **success**. Before treating a PR as reviewed, confirm the bot posted findings or an explicit "no issues" — a green check alone proves nothing.
- **Do not claim a thread was addressed unless you verified the reply posted and `isResolved` changed.** Under-claiming is fine; over-claiming is not.

---

## Handoff to Develop Mode

The disposition is review mode's deliverable. **Implementing** the accepted fixes is **Develop mode** — switch with `develop [feature]` (Review & Archeology mode ends on exactly this hand-off; full spec `.agents/TESTING.md`). There:

1. Write the **failing-first test** before the fix — it must fail on the old behavior and pass on the new. It is both the empirical reproduction of the bug and its regression pin (a fix without one is unproven).

2. **Every guard needs a mutation proof; a discovery-based guard needs an anti-vacuity assertion as well.**
   - _Anti-vacuity:_ if the guard passes by scanning, globbing or iterating a population it discovers at run time, assert the scan found a **non-zero** population before asserting that population is clean. Without it the guard goes green the moment its discovery pattern drifts — measured twice in this repo: a drifted pattern plus a neutered floor passed **green over an empty population**, and weakening a floor to `>= 0` turned a red suite green while the defect was still present. A guard that asserts a single already-known fact (a typed assignment, one fixture's shape) has no population to floor and is exempt — on that ground only. "Nothing to count" must be true of the guard's mechanism, not merely convenient; if the guard discovers what it checks, the floor is mandatory.
   - _Mutation:_ no exemption. Break the thing the guard guards, confirm it fails, and **quote the failure** — for a compile-time or lint-rule guard the compiler or linter error _is_ the failure to quote. A guard nobody tried to defeat is not evidence.
   - _Restore:_ never `git checkout` — that reverts uncommitted work alongside the probe. Take a **pre-probe copy** of the file (`cp`) before mutating, restore from it, and prove the restore with `diff` against that copy — byte-identical, exit 0. A sentinel grep only proves the probe string is gone, not that the surrounding lines came back; keep it as a cheap second check, not as the proof.

3. **Delete a test that passes for the wrong reason; do not ship it green.** If a mutation survives because a mock replaced the very thing under test, or the assertion only proves the test double behaves like a test double, remove it and record why. A green line that looks like coverage is worse than an absent one.

4. Prefer guards that fail at **compile time** or in **production code** (a typed assignment, a lint rule in the shipped config) over guards that live only in a test somebody can delete.

5. Re-run the gate (`yarn build && yarn typecheck && yarn lint`, then `yarn test`); note the suite count. Add **`yarn lint:arch`** whenever the fix touched `.architecture/` — `AGENTS.md:68` gates that one on the edit and stops work on failure, which covers manifest and context-YAML changes made for a port or an adapter. **Confirm the check actually ran, against the current head commit** — a `pull_request` check does not re-fire when the base branch moves, so a stale green (or stale red) can survive a base that has changed underneath it; read the run's SHA, not just its colour.

6. Commit per Develop mode (never push without explicit instruction), then post a **reviewer's-guide** summary on the PR: what changed, what was refuted, what was deferred.

Do not merge on a bot's say-so — merge is a human gate. Green checks plus zero unresolved threads are both required, and neither substitutes for the other.
