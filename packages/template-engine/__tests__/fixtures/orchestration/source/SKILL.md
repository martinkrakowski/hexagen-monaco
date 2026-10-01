---
name: Orchestrate a delegated wave
description: >
  Run one wave of the delegated implementation pipeline for this repo: intake and confirm the
  cast, cut a worktree and branch per lane, dispatch lane briefs to the implementer seat, review
  every PR with two independent models, remediate, sweep the review threads, and merge
  sequentially. Use for "run wave N of the plan", "dispatch the lanes", "orchestrate the
  implementation", "delegate this plan to the agents". Explicit invocation only — it creates
  worktrees, spawns subagents, and opens pull requests.
disable-model-invocation: true
argument-hint: "[plan-path] [wave]"
arguments: [plan, wave]
---

# Orchestrate one delegated wave

You are the **ORCHESTRATOR**. Plan: `$plan`. Wave: `$wave`. If either is empty, ask once, then
proceed — do not guess a plan file.

The full runbook is `docs/workflows/delegated-implementation-pipeline.md` (stage detail, prompt
templates A–D, invariants, failure playbook) and `docs/workflows/orchestrator-kickoff-prompt.md`.
**Read the plan and both documents before acting.** This file is the operating contract and wins
where they differ; it deliberately does not copy them, so they cannot drift apart.

- The cast, and each seat's track record: [references/cast.md](references/cast.md)

- **`references/cast.md` is the authority on current seats; this file does not restate them.**
  Record the worktree tip first and watch the provider's quota. Reviewers stay in-house: a second
  `Agent` that is not the implementer. There is no lane launcher — launch every lane yourself and
  emit its event in the call immediately before. (why: [rationale](references/rationale.md#cast-authority-and-the-retired-launcher))

## Naming waves and lanes

An identifier carries **both** the plan's id and what the lane does — `<plan-id>-<what-it-does>`
for a lane, `<plan-slug>-w<NN>` for a wave, zero-padded. (why: [rationale](references/rationale.md#the-identifier-grammar-and-why-both-halves-are-used))

Zero-pad the wave number: identifiers sort lexicographically, so `w10` lands before `w2`.

**Never use a bare/unqualified id, and never name a wave without the plan slug.** (why: [rationale](references/rationale.md#never-a-bare-id-or-a-wave-with-no-plan-slug))

## Two preconditions that cost the most when skipped

**Run mutations through `yarn mutate`, not by hand.** (why: [rationale](references/rationale.md#run-mutations-through-yarn-mutate-not-by-hand))

```sh
yarn mutate --file <path> --before <before.txt> --after <after.txt> \
  --because "<the input whose behaviour this changes>" -- <test command…>
```

**Two exit codes are in play; do not confuse them** — **`0` caught, `1` survived, `2` refused**. (why: [rationale](references/rationale.md#two-exit-codes-are-in-play-do-not-confuse-them))

**`--because` is required on purpose**: state the prediction before seeing the result. (why: [rationale](references/rationale.md#the---because-flag-and-equivalent-mutants))

**If you mutate by hand anyway, the rest of this section is the checklist you are now keeping
yourself.**

**A mutation is read from the file, never written from memory.** (why: [rationale](references/rationale.md#a-mutation-is-read-from-the-file-never-written-from-memory))

**Then read the right signal**: take the command's exit code, not a grep of test names. (why: [rationale](references/rationale.md#then-read-the-right-signal))

**A fix round is verified to have landed before its PR merges.** Check for the commit, not the
exit code, and **record the tip before you dispatch** — `origin/main..HEAD` also lists the
implementation commits, so it stays non-empty even when a round did nothing. (why: [rationale](references/rationale.md#a-fix-round-is-verified-to-have-landed-before-its-pr-merges))

**Dispose of a class once, not a thread at a time.** (why: [rationale](references/rationale.md#dispose-of-a-class-once-not-a-thread-at-a-time))

**A finding with no mechanism gets a one-line refusal, not an investigation.** "Consider adding…",
"for robustness", "this could be confusing" — ask for the input that fails and resolve. Reopen if
one arrives. Verifying a claim nobody has actually made costs the same as verifying a real one.

## The rule everything else rests on

**Lane status is derived, never asserted.** Before believing any progress report — an
implementer's, a reviewer's, or your own from an earlier turn — run these and let their output be
the status:

```bash
gh pr list --head "<branch>" --json number,url --jq '.[] | "#\(.number) \(.url)"'   # empty ⇒ stuck
git -C "<worktree>" rev-list --count origin/main..HEAD                             # 0 ⇒ it wrote nothing
(cd "<worktree>" && yarn gate)
git -C "<worktree>" status --porcelain=v1 -b && git -C "<worktree>" diff --stat origin/main...HEAD
```

**Run the commit count first, and do not skip it because the seat said `SUCCESS`.** (why: [rationale](references/rationale.md#run-the-commit-count-first-and-do-not-skip-it-because-the-seat-said-success))

**The gate is a subset of CI, and the difference is named.** `yarn gate` (D-X1) runs CI's gate
steps in one command — `check:env` as the same conditional no-op, `build`, `typecheck`, `lint`,
`format:check`, `lint:arch`, `sync:check`, `lint:bytes`, `plan:verify`, `arch:inventory`, the
Nitro route-scan guard, `test:cov` and `verify-manifests` — and stops at the first failure by
name. `ci.yml` runs **one** step it does not:

**`yarn install --immutable`** is not in `yarn gate`. Say in the brief whether a lane may add
a dependency, and if it may, that the regenerated `yarn.lock` travels with it. (why: [rationale](references/rationale.md#yarn-install---immutable))

**`yarn lint:bytes`** is in the gate, deliberately — it is not inside `yarn typecheck`. (why: [rationale](references/rationale.md#yarn-lintbytes))

**The Nitro route-scan guard is a `yarn gate` step** (`nitro-route-scan`), so a lane that adds or
moves a test file under `apps/api/server/` is covered by the gate itself. (why: [rationale](references/rationale.md#the-other-two-checkenv-and-the-nitro-route-scan-guard))

**A green local gate is not a green CI: diff your gate against the CI workflow first.** (why: [rationale](references/rationale.md#a-green-local-gate-is-not-a-green-ci))

Read the diffstat's **deletions**, not just its file count: a tree removing tests whose sources
still exist is thrashing, not progress. A lane with **no PR has not started stage 2**, and stage 2
is the only stage that finds defects. If the derived status contradicts the report, the derived
status wins and your summary says so.

**Every lane brief ends with two lines, and they are not optional.** Both were earned:

- *If a finding is wrong, say so with the mechanism rather than changing code to match it.* Counters
  the failure that rots a suite quietly — an assertion weakened until it passes.
- *Run the gate in the foreground and read its exit code. A task you launched is not a result.* Two
  seats reported green gates they had started and never watched; one of those branches did not
  typecheck.

- *Measure a file's coverage the way the gate does — a claim of per-file 100% without the JSON
  reporter's per-file listing is not evidence.* (Template A, [pipeline
  doc](../../../docs/workflows/delegated-implementation-pipeline.md#template-a--lane-brief-implementer))
- *A loaded host is a reason to show the isolated pass and let CI be the gate, never to raise a test
  timeout.* (Template A, [pipeline
  doc](../../../docs/workflows/delegated-implementation-pipeline.md#template-a--lane-brief-implementer))

**Know which gates are enforced by CI and which are enforced by you.** `plan:verify`, a lane
retiring its own premise, and `mutate:verify` on a changed manifest are **CI**; a manifest existing
at all, and `handoff:check` on a two-stage lane, are **habits only you enforce**. (why: [rationale](references/rationale.md#which-gates-are-machinery-and-which-are-you))

**A two-stage lane hands over a handoff file, not a claim.** (why: [rationale](references/rationale.md#a-two-stage-lane-hands-over-a-handoff-file-not-a-claim))

**And every lane brief opens by asking the lane to prove the defect before changing anything:**

> Restate the defect in your own words and demonstrate it — the failing test, the wrong output, the
> command that misbehaves. If you cannot reproduce it, **stop and report that**. Do not implement
> against a defect you have not seen.

(why: [rationale](references/rationale.md#and-every-lane-brief-opens-by-asking-the-lane-to-prove-the-defect-before-changing-anything))

**Every cell of your final table is command output, not recollection.** If you cannot produce the
output for a cell, the cell is *unknown* — a valid answer. A confident wrong one is not.

## Before you dispatch

1. **Verify main is green** and the tree is clean. Fast-forward local main.
2. **Give the subagent what it cannot infer.** It inherits none of this conversation, so its
   prompt must carry the **absolute worktree path**, the branch, whether a PR already exists, and
   the house rules below. A brief that assumes context the agent does not have is the
   equivalent of an unfunded seat: a whole cycle, nothing to show.

3. **Prove each seat with a trivial DISPATCH, not a chat probe — and give a failing seat one
   attempt per wave.** Edit a scratch file in the lane worktree, confirm it changed, delete it and
   verify the tree is clean, then dispatch for real; when a seat fails, **switch rather than debug**.
   (why: [rationale](references/rationale.md#3-prove-each-seat-with-a-trivial-dispatch-not-a-chat-probe))

4. **Confirm the cast, the lanes and their file ownership** with the owner, and wait for the
   go-ahead. If the plan does not assign file ownership per lane, say so — that is a plan defect
   and the lanes will collide.
5. **Red-team each lane brief against the code before dispatching it.** Every path, symbol and line
   number a brief cites must exist; every acceptance criterion must be able to fail. This step has
   caught false premises that would have stalled a lane at its mandatory mutation check.
6. **Red-team each brief against ITSELF for completeness.** Step 4 checks that what a brief cites
   exists. This step checks that what it *omits* was a decision. **A lane implements the brief's
   enumeration, not its adjective** — "in full", "the whole surface", "all the relevant fields"
   carry no information the implementer can act on, and they actively suppress the question,
   because a lane that sees a list assumes the list was checked.

   Before dispatch, for every brief:

   - **Grep the lane id against every plan, not only its own** (`grep -rniw '<ID>' docs/planning/`),
     matching on word boundaries, **never** on `**<ID>**`. (why: [rationale](references/rationale.md#grep-the-lane-id-against-every-plan-not-only-its-own))

   - **Check the gap is still open before dispatching the lane that closes it.** (why: [rationale](references/rationale.md#check-the-gap-is-still-open-before-dispatching-the-lane-that-closes-it))

   - **If it names a type or a document surface, open that type and paste its fields in.** A brief
     covering `CopyTimeline` names five things, because `CopyBeat` is `{text, weight, background?}`
     and `CopyTimeline` is `{beats, transition, keyBeat}`.
   - **Write one test requirement per field**, so a missed field fails a test instead of shipping.
   - **If a value is parsed from a string, name the hazards**: leading zeros, values past
     `Number.MAX_SAFE_INTEGER`, delimiters that can appear in the data.
   - **If the lane compares or gates on state, list the inputs and their refresh cadence.** Two
     sides collected at different times need a carve-out, not a threshold.

(why: [rationale](references/rationale.md#four-defects-on-2026-09-16-came-from-briefs-that-failed-exactly-this))

   The tell is an adjective standing where a list belongs. When you write one, stop and enumerate.

7. **Check the plan's premises first.** `yarn plan:verify` fails when a lane's stated gap has already
   been closed. Four lanes in one week were dispatched, or nearly dispatched, to re-implement shipped
   behaviour. A lane whose premise no longer holds is not a lane.

8. **Every fence you write must be TIMED and shown to decide, before it lands.** `plan:verify`
   kills a premise at **10 seconds**; record the wall time beside each fence, in **milliseconds**.
   Verify three things: that it **holds today**, that it **can flip**, and that it **answers fast**.
   (why: [rationale](references/rationale.md#8-every-fence-you-write-must-be-timed-and-shown-to-decide-before-it-lands))

   Prefer a probe over a scan: grep one file for the marker that means the lane is done, rather
   than recomputing the lane's whole subject. If the honest completion marker is a gate step, grep
   the workflow for it — a lane that wires a gate cannot land without satisfying that gate, so the
   marker cannot be forged.

9. **Send the plan to the plan reviewer** (`Agent` · `subagent_type: "Plan"` · `model: "fable"`)
   before dispatching any lane from it, whenever the plan introduces or rewrites lanes or changes a
   premise. Nothing else needs this seat. (why: [rationale](references/rationale.md#9-send-the-plan-to-the-plan-reviewer))

## The six stages

*Emitting is part of the stage, not a courtesy.* Every transition below appends one event via
`scripts/wave-event.sh <logdir> <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']`
— one JSON line in `<logdir>/events.jsonl` — and a stage with no event is, to the server, a stage
that did not happen.

1. **Implement.** One lane = one worktree = one branch = one PR. `yarn install` per worktree
   yourself — **one at a time, never in parallel, and only where the lane actually needs one.**

   Skip the install **only for a lane that runs no local command needing dependencies** (a
   docs-only lane and little else — a deletion lane still needs `node_modules`). (why: [rationale](references/rationale.md#yarn-berry-hardlinks-package-contents-from-a-shared-global-cache))

   And **after a wave's installs, verify the main checkout still has its native binaries** rather
   than letting the owner's next dev start find out:

   ```sh
   # Names any platform package left with metadata only, and is silent when healthy.
   #
   # `find node_modules -name '*.node' | head` is NOT a check: a stripped package simply
   # contributes no line, so the command prints the survivors and exits 0 — it reports what
   # exists, never what is missing. Nor is "has a .node file" the test: @esbuild ships
   # `bin/esbuild`, @img/sharp-libvips ships `lib/`, and both are healthy with no .node at
   # all. The payload test below has neither false negative nor false positive on this repo.
   for d in node_modules/@*/*darwin*/ node_modules/*darwin*/; do
     [ -d "$d" ] || continue
     n=$(find "$d" -type f ! -name '*.json' ! -name '*.md' ! -name 'LICENSE*' | wc -l)
     [ "$n" -eq 0 ] && echo "STRIPPED: $d"
   done
   ```

(why: [rationale](references/rationale.md#what-the-stripped-binary-check-found))

   The repair is to delete the stripped package directory and reinstall — a plain `yarn install` will
   not restore it, because the directory's presence makes the package look installed.

   Write each brief from Template A, then dispatch it as an `Agent`. **Record the worktree tip
   first** — an agent that reports success having committed nothing looks identical to one that did
   the work. Never let two lanes own the same file at the same time.

   **A lane is not done until the PR exists, and lanes routinely stop one step short.** Write
   "commit, push, and open the PR with `gh pr create`" as the explicit final instruction in every
   brief; when a lane stops anyway, **finish it mechanically yourself** after verifying the diff. (why: [rationale](references/rationale.md#a-lane-is-not-done-until-the-pr-exists-and-lanes-routinely-stop-one-step-short))

   **Emit the event in the tool call immediately before the launch, with nothing between them** —
   never afterwards, never "as you go". **There is no launcher that emits for you, and there will not
   be one.** Emission is therefore yours. (why: [rationale](references/rationale.md#emit-the-event-in-the-tool-call-immediately-before-the-launch))

   Emit as you go (`scripts/wave-event.sh`): `dispatch started` per lane just before its launch,
   carrying the seat that runs it in `--detail` — `--detail '{"seat":"<implementer model>"}'` — because
   the status page names the seat that ran each lane, and a lane whose record never names one reads
   **unknown**. The seat is a property of the lane, so later stages need not repeat it.
   **When the seat is an external CLI** (the `openrouter/` roster in `references/cast.md`), launch it
   directly from a tool call — `nohup zsh -c "cd <worktree> && <cli> … \"\$(cat <ABSOLUTE brief>)\" >
   <log> 2>&1; echo \"EXIT \$?\" >> <log>" < /dev/null > /dev/null 2>&1 & disown` — from a tool call
   that returns straight away, never from a wrapper that launches and then waits (see above). The
   brief path **must be absolute**: the command `cd`s into the worktree first and `briefs/` exists only
   in the main checkout. The template assumes paths without spaces or glob characters, true of this
   repo's worktrees; quote them for the inner shell if that ever changes. Liveness differs by CLI:
   `opencode run --format json` streams within seconds, so a log still at 0 bytes after ~30 s **with no
   `opencode run` process for that worktree** (`pgrep -f 'cd <worktree> && opencode'`) is a dead lane;
   `agy --print` writes nothing until it exits, so watch its process and the worktree's commits. Never
   call a lane dead from the log alone.

   **Every brief carries the checkpoint rule**: commit failing tests once seen to fail, commit
   again after each green step, push only when the gate passes — a scoped, owner-confirmed exception
   to `.agents/testing.md`, limited to a lane's own branch. **Do not rewrite history to hide them.**
   (why: [rationale](references/rationale.md#every-brief-carries-the-checkpoint-rule))

   The per-lane `implement settled|failed` events **are** the completion record of a dispatch —
   `implement settled` when a lane's `EXIT` marker lands, `implement failed` on a non-zero
   marker or a lane killed without one; and `gate settled` with the gate exit and the four
   coverage numbers (statements, branches, functions, lines) in `--detail` once the gate has run.
2. **Review.** Two independent inputs per PR, both required: a read-only review from a model that
   is **not** the implementer, and the bot comments (`gh pr checks`, `gh api …/comments`). Verify
   every finding — yours and the bots' — against the branch diff before acting on it. Require the
   reviewer to remove any throwaway worktree it created, and check: two have been left behind.
   When the review of a PR is dispositioned, emit `review settled` (`scripts/wave-event.sh`)
   with the counts of BUG / SUGGESTION / NIT findings in `--detail`.

3. **Remediate.** Merge verified findings into a fix brief (Template C), listing refuted items
   with reasons. **After any interrupted or killed `mutate:verify`, scan for a stranded mutation
   before anything commits.** (why: [rationale](references/rationale.md#3-remediate))

   Run the remediator in that worktree, then **verify it yourself**: full gate, re-read the
   diff. Never merge on a remediator's self-report.
   After each round you verify, emit `remediate settled` per round (`scripts/wave-event.sh`)
   with the fixed/refuted counts in `--detail`.
4. **Sweep** (you, no CLI). Per thread: verify → reply with the resolution and its commit, or the
   refutation and its mechanism → resolve. Then one disposition comment per PR. A refutation is a
   first-class outcome; a silently ignored comment is indistinguishable from an overlooked one.
   When a PR's threads are all dispositioned, emit `sweep settled` with the `fixed` / `refuted` /
   `deferred` counts in `--detail`.
5. **Merge** (you). Sequential, via `scripts/merge-prs.sh` — each merge invalidates the CI of
   everything behind it. If main goes red: stop, reproduce locally, ship a minimal hotfix, resume.
   **A green gate is not a merge condition on its own.** Merge only when, on the PR's *final* head:
   every check-run conclusion is success, skipped or neutral (read conclusions, not the rollup line —
   `neutral` is what informational checks report); the review bots have had time to post on that head;

   and **zero review threads are unresolved**. `scripts/merge-prs.sh` **enforces this
   mechanically** and re-reads the PR's head immediately before `gh pr merge`, refusing if it moved.
   **The settle period is a wait, not a proof the bots reviewed the final head** — confirm a bot
   actually posted on it yourself. (why: [rationale](references/rationale.md#scriptsmerge-prssh-enforces-this))

   After each merge lands, emit `merge settled` with the merge SHA in `--detail`.
6. **Close the wave** (you, immediately — not later). Append the orchestrator's wave record to
   `.agents/session-log.md`: what merged with its commits, what was refuted **and why**, what the
   review layer actually bought, any defect found in the *plan* rather than the code, and what
   stays deferred. **A wave is not finished when its PRs merge; it is finished when that record is
   committed.** Do this before dispatching the next wave, even under standing authorization —
   especially then, because chained waves are exactly where it slides. If a lane's own session-log
   entry already exists, yours is still owed: a lane reports on itself, the orchestrator reports on
   the wave.
   When the record is committed, emit `record settled` with the PR number in `--pr`.

## Your authority, and its limits

Decide without asking: lane boundaries within the plan's ownership table, brief contents, whether a
finding is real, whether a bot comment is refuted, when a PR is ready, merge order.

**You write no feature code** unless intake put you in the implement seat. Even then, keep the
seats separate in time and never review your own code in the same context.

**Standing authorization.** When the owner says to run the remaining waves without stopping
("don't stop until it's done", "merge when green and proceed"), that replaces the per-wave
go-ahead and you do **not** surface for permission you already have — dispatch the next wave as
soon as its gate clears. It does not replace the stop conditions below, and it does not excuse the
wave record (stage 6): closing out is part of finishing, not a thing you do at the end if there is
time. Yielding a turn while a lane runs is not stopping; ending a turn with a status report and
waiting to be told to continue *is*, and under standing authorization it is wrong.

**Stop and report** when: two lanes need the same file and the plan is silent; a merge conflicts
outside the append-only allowlist; main goes red; a lane's CLI exits non-zero without a PR; a
finding cannot be verified against the code; the plan and the code contradict each other on a
locked decision; or a seat runs out of credit.

## House rules that bite here

- **Never spawn a funded model seat to reproduce a defect.** Reproduce dispatch and launcher
  behaviour with a stub process, never a paid CLI. (why: [rationale](references/rationale.md#never-spawn-a-funded-model-seat-to-reproduce-a-defect))

- **Touching a manifest arms it.** CI replays only the manifests a change *touches*, so editing
  one for an unrelated reason pulls it into the replay set. `yarn mutate:anchors` checks every
  anchor cheaply ahead of the replay, and also checks whether the `command`'s `-t` still selects a
  test — verify it with `yarn vitest list <file> -t '<pattern>'` before you record it. Re-anchor
  when the code moved; retire (`"retired": "<why>"`) only when it is gone. (why: [rationale](references/rationale.md#touching-a-manifest-arms-it))

- **Before `git reset --hard`, save the diff.** Commit before you test, not after. (why: [rationale](references/rationale.md#before-git-reset---hard-save-the-diff))

- **A mutation you did not confirm applied is not a mutation.** (why: [rationale](references/rationale.md#a-mutation-you-did-not-confirm-applied-is-not-a-mutation))

- **Never `git add -A`.** `briefs/` and `assets/inputs/*/` are the owner's operator data.
- **Never start a dev server or curl `localhost:3000` / `:3001`** — those are the owner's live
  servers; a request there overwrites their output and spends their GenAI credits.
- **Run full gates in a worktree**, never in the main checkout beside a running dev server: the
  build shares `.next/` and will disturb it.
- `best_practices.md` is the reviewer-facts file. Check it before endorsing a finding class it
  disproves, and extend it when a new premise-false class appears.

## Reporting contract

After each stage, a few lines: what ran, what came back, what you decided, what is next. At the
end, one table: `PR | branch | URL | gate | fixed | refuted`. Never claim a fix you have not
verified, never report a lane done without a PR URL you have just listed, and never call a merge
complete until you have confirmed main contains it. When stuck, say **STUCK** and what blocks it —
a stalled lane reported as progress costs far more than one reported as stuck.

Every wave gets its record at stage 6, committed before the next wave dispatches. At the end of the
run, open one session-log PR carrying whichever records are not yet on `main`, then report whether
the plan has a next wave. **Stop there unless the owner gave standing authorization** — see
*Standing authorization* above; with it, keep going and let the records, not the pauses, be what
proves each wave finished.
