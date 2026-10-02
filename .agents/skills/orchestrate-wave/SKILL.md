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

The full runbook is the delegated-implementation-pipeline document (stage detail, prompt
templates A–D, invariants, failure playbook) and the orchestrator-kickoff-prompt document. **Read the plan before acting, and, where the project
ships them, both runbooks** (`docs/workflows/delegated-implementation-pipeline.md` and
`docs/workflows/orchestrator-kickoff-prompt.md`). This file is the operating contract either way,
and wins where they differ; it deliberately does not copy them, so they
cannot drift apart. **Prompt templates A–E ship with this skill**, in
`references/briefs.md`, so the five briefs this file orders by name never depend on a runbook the
project may not have.

- The cast, and each seat's track record: the overlay's `cast.md`, at `.agents/orchestration/cast.md`

- **The overlay's `cast.md` is the authority on current seats; this file does not restate
  them.** Record the worktree tip first and watch the provider's quota. Reviewers stay in-house: a
  second `Agent` that is not the implementer. There is no lane launcher — launch every lane
  yourself and emit its event in the call immediately before. (why: [rationale](references/rationale.md#cast-authority-and-the-retired-launcher))

## Read the overlay right after this contract

Everything above is the same for every project. Everything project-specific lives in the
consumer-owned overlay at `.agents/orchestration/`, which hexagen never emits and never
overwrites. **Read `.agents/orchestration/config.yaml` right after this contract.** If it is
absent, or a field of it is absent, these are the defaults and you state them inline:

- `planDir: docs/planning` — where the plans live.
- `gateSteps` — the ordered list the gate reads. With no config, the steps named in the brief
  are the list.
- `requiredCheck: ^Build` — the CI check whose conclusion a merge waits for.
- `ciWorkflow: .github/workflows/ci.yml` — the CI workflow `doctor` requires to exist, as a repository-relative path.
- `appendOnlyPaths` — empty. Nothing is append-only until the project says which paths are.
- `forbiddenPorts` — **no forbidden ports.** The absent default is an empty list. A scaffolded
  config may name ports; an absent field names none.
- `operatorDataPaths` — empty. With none declared, the project stages nothing it was not told to.
- `laneHosts` and `seats` — both `[]`, unset. `laneHosts` says where and how a delegated lane runs
  (its transport prefix, its gate scope, and for a remote host the checks and paths to reach it);
  `seats` says who runs it (an agent and a model, each naming a host). Both are declared in
  `.agents/orchestration/config.yaml`. With none declared, ask the owner which host and seat; never
  start a server.
- `installProbes` — `[]`, no probes. Each is `{package, check, repair?}`; stage 1 says when the orchestrator runs them.
- `waveLogDir` — `$HOME/.waves-<name>`, where `<name>` is the name half of `repo`. Never a
  bare shared wave-log root: another project's status server scans one, and a wave logged there
  reports against the wrong repository.
- `waveStatusPort` — `4318`.
- `coverageRequirement` — whatever the project's own test command already enforces.
- `mutate: false` — the mutation-family steps stay out of the resolved list until a project
  turns them on.
- `tokensCssPath` — unset; the server falls back to its own neutral token set.
- `overrides: []`
- `repo` — required. If it is absent from the config, ask for it; never guess a repository.
- `invariants` — `statusSource: derived`, `eventDuty: true`, `mergeRequiresGreenGate: true`,
  `attribution: false`.

Those four **invariants** are the core ones, locked to exactly those defaults: status is
**derived** from the branch rather than asserted from a progress report; the **emit-an-event
duty**, so no lane is ever launched without its event already written; **never merging a red
gate**; and **no attribution** in commits and PRs.

**An `overrides:` entry is surfaced before the first lane dispatches.**
`hexagen-orchestration-doctor` runs at the start of every wave and prints every entry it finds.
A lane never discovers a weakened invariant by reading the config for itself, and an entry is
never buried in a log the orchestrator skims.

**The overlay may ADD rules, may TIGHTEN rules, and may not silently WEAKEN a core invariant.**
Weakening one of the four requires an `overrides:` entry naming that invariant with a reason.
Everything else the overlay holds — `house-rules.md`, `cast.md`, `lessons.md`,
`rationale.local.md` — is the project's own, this file never restates it, and hexagen's upgrade
path never touches it.

## Naming waves and lanes

An identifier carries **both** the plan's id and what the lane does — `<plan-id>-<what-it-does>`
for a lane, `<plan-slug>-w<NN>` for a wave, zero-padded. (why: [rationale](references/rationale.md#the-identifier-grammar-and-why-both-halves-are-used))

Zero-pad the wave number: identifiers sort lexicographically, so `w10` lands before `w2`.

**Never use a bare/unqualified id, and never name a wave without the plan slug.** (why: [rationale](references/rationale.md#never-a-bare-id-or-a-wave-with-no-plan-slug))

## Two preconditions that cost the most when skipped

**Run mutations through `hexagen-orchestration-mutate`, not by hand.** (why: [rationale](references/rationale.md#run-mutations-through-the-mutation-bin-not-by-hand))

```sh
hexagen-orchestration-mutate --file <path> --before <before.txt> --after <after.txt> \
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
(cd "<worktree>" && npx --no-install hexagen-orchestration-gate)
git -C "<worktree>" status --porcelain=v1 -b && git -C "<worktree>" diff --stat origin/main...HEAD
```

**Run the commit count first, and do not skip it because the seat said `SUCCESS`.** (why: [rationale](references/rationale.md#run-the-commit-count-first-and-do-not-skip-it-because-the-seat-said-success))

**The gate is a subset of CI, and the difference is named.** The gate binary runs the
project's configured `gateSteps` in one command — the list `config.yaml` carries, in order, and
stops at the first failure by name. `ci.yml` runs **one** step it does not:

**`yarn install --immutable`** is not in the gate. Say in the brief whether a lane may add
a dependency, and if it may, that the regenerated `yarn.lock` travels with it. (why: [rationale](references/rationale.md#yarn-install---immutable))

**Where a project's `gateSteps` carry a byte-level scan, it is its own step — it is not inside the
typecheck step.** Nothing else in a usual gate set looks at bytes. The scaffolded config does not add
one: the gate is a subset of CI, and a scaffold-added step the project did not choose would be a
required step that fails wherever the scan's bin is not installed (only a `yarn <script>` step can
skip), so adding it is the project's own decision. (why: [rationale](references/rationale.md#the-byte-level-scan))

**A project-specific guard (for example a route-registry scan) belongs in `gateSteps` as its own
step**, so a lane that adds or moves a test file into a scanned directory is covered by the gate
itself rather than by a reviewer's memory. (why: [rationale](references/rationale.md#the-other-two-a-conditional-no-op-and-a-route-registry-guard))

**A green local gate is not a green CI: diff your gate against the CI workflow first.** (why: [rationale](references/rationale.md#a-green-local-gate-is-not-a-green-ci))

Read the diffstat's **deletions**, not just its file count: a tree removing tests whose sources
still exist is thrashing, not progress. A lane with **no PR has not started stage 2**, and stage 2
is the only stage that finds defects. If the derived status contradicts the report, the derived
status wins and your summary says so.

**Every lane brief ends with two lines, and they are not optional.** Both were earned:

- *If a finding is wrong, say so with the mechanism rather than changing code to match it.* Counters
  the failure that rots a suite quietly — an assertion weakened until it passes.
- *Run every verification command in the foreground and read its exit code. A task you launched is not a result.* Two
  seats reported green gates they had started and never watched; one of those branches did not
  typecheck.

- *Measure a file's coverage the way the gate does — a claim of per-file 100% without the JSON
  reporter's per-file listing is not evidence.* (Template A, in `references/briefs.md`.)
- *A loaded host is a reason to show the isolated pass and let CI be the gate, never to raise a test
  timeout.* (Template A, in `references/briefs.md`.)

**Know which gates are enforced by CI and which are enforced by you.** The plan verifier, a
lane retiring its own premise, and the mutation verifier on a changed manifest are **CI**; a
manifest existing at all, and the handoff check on a two-stage lane, are **habits only you
enforce**. (why: [rationale](references/rationale.md#which-gates-are-machinery-and-which-are-you))

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

   - **Mark the plan's lane and decision tables.** `hexagen-orchestration-plan-review` finds a
     row by its bold id (`| **<id>** |`), and a plan that bolds the same id in a second table
     — a shipped list, a findings table — makes the row ambiguous. Put `<!-- plan-review: lanes -->`
     before a lane table and `<!-- plan-review: decisions -->` before a decision table. A marker
     holds across prose and further tables until the next heading of any level, so a table split by
     a paragraph stays covered, and every table needs a marker under its own heading. A plan with
     no marker keeps the old rule (every bold-id row counts); once a plan has one, only rows inside
     a marked region count. Either marker satisfies any id lookup. Adding a marker never changes a
     row's hash.

   - **Check the gap is still open before dispatching the lane that closes it.** (why: [rationale](references/rationale.md#check-the-gap-is-still-open-before-dispatching-the-lane-that-closes-it))

   - **If it names a type or a document surface, open that type and paste its fields in.** A
      brief that names a type covers every field that type declares — a reader who cannot see the
      declaration will implement the subset the brief happened to mention, and each field it omits
      ships untested.
    - **Write one test requirement per field**, so a missed field fails a test instead of shipping.
    - **If a value is parsed from a string, name the hazards**: leading zeros, values past
      `Number.MAX_SAFE_INTEGER`, delimiters that can appear in the data.
    - **If the lane compares or gates on state, list the inputs and their refresh cadence.** Two
      sides collected at different times need a carve-out, not a threshold.

(why: [rationale](references/rationale.md#four-defects-came-from-briefs-that-failed-exactly-this))

   The tell is an adjective standing where a list belongs. When you write one, stop and enumerate.

7. **Check the plan's premises first.** `hexagen-orchestration-plan-verify` fails when a
   lane's stated gap has already been closed. Four lanes in one week were dispatched, or nearly
   dispatched, to re-implement shipped behaviour. A lane whose premise no longer holds is not a
   lane.

8. **Every fence you write must be TIMED and shown to decide, before it lands.** `plan:verify`
   kills a premise at **10 seconds**; record the wall time beside each fence, in **milliseconds**.
   Verify three things: that it **holds today**, that it **can flip**, and that it **answers fast**.
   (why: [rationale](references/rationale.md#8-every-fence-you-write-must-be-timed-and-shown-to-decide-before-it-lands))

   Prefer a probe over a scan: grep one file for the marker that means the lane is done, rather
   than recomputing the lane's whole subject. If the honest completion marker is a gate step, grep
   the workflow for it — a lane that wires a gate cannot land without satisfying that gate, so the
   marker cannot be forged.

9. **Send the plan to the plan reviewer** — the seat the overlay's `cast.md` names for plan
   review — before dispatching any lane from it, whenever the plan introduces or rewrites lanes or
   changes a premise. Nothing else needs this seat. (why: [rationale](references/rationale.md#9-send-the-plan-to-the-plan-reviewer))

## The six stages

*Emitting is part of the stage, not a courtesy.* Every transition below appends one event via
`hexagen-orchestration-wave-event <logdir> <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']`
— one JSON line in `<logdir>/events.jsonl`, where `<logdir>` is the wave's directory under the
configured `waveLogDir` — and a stage with no event is, to the server, a stage
that did not happen.

1. **Implement.** One lane = one worktree = one branch = one PR. `yarn install` per worktree
   yourself — **one at a time, never in parallel, and only where the lane actually needs one.**

   Skip the install **only for a lane that runs no local command needing dependencies** (a
   docs-only lane and little else — a deletion lane still needs `node_modules`). (why: [rationale](references/rationale.md#yarn-berry-hardlinks-package-contents-from-a-shared-global-cache))

   **Run the config's `installProbes` once the install finishes, before the worktree is
   dispatched.** Under concurrent installs on one host a dependency's postinstall binary can be
   silently skipped, and a lane then fails on a missing binary it cannot repair. Each probe is
   `{package, check, repair?}`. On a remote lane host run it as `ssh <alias> -- <check>` inside the
   new worktree; on a local host run `check` in the worktree. When a `check` fails, run its
   `repair` ONCE (same host, same worktree), emit the repair as a wave event, then run `check`
   again. If `check` still fails, or `repair` is absent or exits non-zero, **do not dispatch that
   worktree**: report the package and both exit codes. `hexagen-orchestration-doctor` runs the
   `check` of each probe on your own host, never a `repair`, and reports a failing `check` as FAIL.
   (why: [rationale](references/rationale.md#install-probes))

   And **after a wave's installs, verify the main checkout still has its native binaries** rather
   than letting the owner's next dev start find out:

   ```sh
   # Names any platform package left with metadata only, exits non-zero when it names one, and
   # exits non-zero when it discovers NO platform package at all: a loop over nothing proves nothing,
   # and an unmatched glob must not read as healthy. Run it on a Darwin host, and run it under `sh`
   # (zsh's `nomatch` aborts the loop on an unmatched glob).
   #
   # `find node_modules -name '*.node' | head` is NOT a check: a stripped package simply
   # contributes no line, so the command prints the survivors and exits 0 — it reports what
   # exists, never what is missing. Nor is "has a .node file" the test: @esbuild ships
   # `bin/esbuild`, @img/sharp-libvips ships `lib/`, and both are healthy with no .node at
   # all. The payload test below has neither false negative nor false positive on this repo.
   found=0 stripped=0
   for d in node_modules/@*/*darwin*/ node_modules/*darwin*/; do
     [ -d "$d" ] || continue
     found=$((found + 1))
     n=$(find "$d" -type f ! -name '*.json' ! -name '*.md' ! -name 'LICENSE*' | wc -l)
     if [ "$n" -eq 0 ]; then echo "STRIPPED: $d"; stripped=$((stripped + 1)); fi
   done
   [ "$found" -gt 0 ] || echo "NOTHING DISCOVERED: no *darwin* package under node_modules"
   [ "$found" -gt 0 ] && [ "$stripped" -eq 0 ]
   ```

(why: [rationale](references/rationale.md#what-the-stripped-binary-check-found))

   The repair is to delete the stripped package directory and reinstall — a plain `yarn install` will
   not restore it, because the directory's presence makes the package look installed.

   Write each brief from Template A in `references/briefs.md`, then dispatch it as an `Agent`.
   **Record the worktree tip first** — an agent that reports success having committed nothing looks
   identical to one that did the work. Never let two lanes own the same file at the same time.

   **A lane is not done until the PR exists, and lanes routinely stop one step short.** Write
   "commit, push, and open the PR with `gh pr create`" as the explicit final instruction in every
   brief; when a lane stops anyway, **finish it mechanically yourself** after verifying the diff. (why: [rationale](references/rationale.md#a-lane-is-not-done-until-the-pr-exists-and-lanes-routinely-stop-one-step-short))

   **Emit the event in the tool call immediately before the launch, with nothing between them** —
   never afterwards, never "as you go". **There is no launcher that emits for you, and there will not
   be one.** Emission is therefore yours. (why: [rationale](references/rationale.md#emit-the-event-in-the-tool-call-immediately-before-the-launch))

   Emit as you go: `dispatch started` per lane just before its launch, carrying the seat that
   runs it in `--detail` — `--detail '{"seat":"<implementer model>"}'` — because
   the status page names the seat that ran each lane, and a lane whose record never names one reads
   **unknown**. The seat is a property of the lane, so later stages need not repeat it.
   **When the seat is an external CLI**, the roster the overlay's `cast.md` names, launch it
   directly from a tool call that returns straight away, never from a wrapper that launches and then
   waits (see above): the launch `cd`s into the lane's own worktree, the brief path **must be
   absolute**, the command appends an `EXIT` marker to a log the later call polls, and a probe
   artefact is deleted before the lane is dispatched for real. The template assumes paths without
   spaces or glob characters; quote them for the inner shell if that ever changes. Liveness differs
   by CLI: some stream within seconds, so a log still at 0 bytes after ~30 s **with no process for
   that worktree** is a dead lane, while a CLI that writes nothing until it exits must be watched by
   its process and the worktree's commits. Never call a lane dead from the log alone.

   **Delegated seats and lane hosts.** The overlay's `laneHosts` and `seats` name where a delegated
   lane runs and who runs it. These rules hold for every host:

   1. A remote opencode server executes its tools on the server side. `--dir` is the server
      worktree path. The orchestrator creates that worktree over `ssh`, fetches the lane's commits
      back, then runs the full gate, pushes and opens the PR itself. The lane never pushes; its brief
      carries Template A's lane-host variant.
   2. A sandboxed seat can read only its worktree. Its brief lives at `.lane/brief.md` inside the
      worktree, and is verified with `git check-ignore` before dispatch.
   3. A `gate: targeted-only` host runs targeted tests and replays only. Its briefs forbid the full
      gate. The full gate runs on the orchestrator's host, and CI stays the gate.
   4. Lane liveness is the bytes streamed from the dispatch, plus the lane's commit count against
      the tip recorded before dispatch. An exit code of 0 is not evidence.
   5. A lane host's `check` exercises the same path as its `dispatch`. A check that only proves the
      remote server is up can pass while the dispatch fails.
   6. Record the lane's `sessionID` from the first `--format json` event of its dispatch, alongside
      the worktree tip recorded before dispatch. A host's `usage` reader is invoked as
      `<usage…> --server <laneHosts[].server> --session <id>` with that id when the host has
      `laneHosts[].server`; a host without `server` keeps the legacy form, `<usage…> <worktree path>`
      (for example a worktree-based usage script), and
      `hexagen-orchestration-lane-watch follow` takes the same two flags to watch the session. Both
      need the host's `server` (a loopback URL, reached through a tunnel; the caller is assumed to keep it open, which is an open owner question in P-D2). A
      `usage` reading that prints `unknown` and exits 3 is incomplete, not zero.
   7. **A fix round resumes the lane's own session when the dispatch transport supports it, and
      forks it when the branch has moved** since the lane's last turn (a merge, a refresh). With
      opencode that is `run -s <sessionID>`, plus `--fork` when the branch moved, using the
      `sessionID` recorded in rule 6. These flags are orchestrator-side: they go in the dispatch
      command, never in a lane brief. **Stagger forked resumes by about 20 s.** Two forks launched
      in the same second fail with "database is locked" (opencode's sqlite). (why: [rationale](references/rationale.md#a-fix-round-resumes-the-lanes-own-session))
   8. **A lane's result is verified on a host other than the one it ran on before it is merged.**
      For a remote lane host, the second host is yours: run the gate after fetching the commits,
      before the PR opens. For a local lane host, CI is the second host: open the PR and read CI's
      conclusion on the PR's final head before merging, never your own gate alone. (why: [rationale](references/rationale.md#a-lanes-result-is-verified-on-a-second-host))

   **Every brief carries the checkpoint rule**: commit failing tests once seen to fail, commit
   again after each green step, push only when the gate passes — a scoped, owner-confirmed exception
   to `.agents/testing.md`, limited to a lane's own branch. **Do not rewrite history to hide them.**
   (why: [rationale](references/rationale.md#every-brief-carries-the-checkpoint-rule))

   The per-lane `implement settled|failed` events **are** the completion record of a dispatch —
   `implement settled` when a lane's `EXIT` marker lands, `implement failed` on a non-zero
   marker or a lane killed without one; and `gate settled` with the gate exit and the coverage
   numbers `config.yaml` requires (statements, branches, functions, lines) in `--detail` once the
   gate has run.
2. **Review.** **How many model reviews a lane gets follows the plan row's risk column.** A
   normal-risk lane gets ONE combined reviewer pass covering the plan row, the brief and the
   implementation diff together. A high-risk lane keeps separate row, brief and pre-PR reviews, each its own
   pass. The review bots stay on every PR at either tier: they have found real defects after the
   model reviewer approved. (why: [rationale](references/rationale.md#review-tiering-follows-the-plan-rows-risk)) Per PR, two independent inputs, both required: a read-only review from a model that
   is **not** the implementer, and the bot comments (`gh pr checks`, `gh api …/comments`). Verify
   every finding — yours and the bots' — against the branch diff before acting on it. Require the
   reviewer to remove any throwaway worktree it created, and check: two have been left behind.
   When the review of a PR is dispositioned, emit `review settled` with the counts of BUG /
   SUGGESTION / NIT findings in `--detail`.

3. **Remediate.** Merge verified findings into a fix brief (Template C, in
   `references/briefs.md`), listing refuted items with reasons. For a fix round where the lane commits only,
   draft the brief with `hexagen-orchestration-fix-brief --pr <n> --round <k> …` instead: it renders Template E
   from the PR's unresolved threads, and you set each item's `Disposition:` before dispatch. Findings from the
   read-only pre-PR review that were never posted as threads are not in that output: append them yourself as
   additional items in the same layout. Template C remains the brief for a fix lane that pushes. **After any interrupted or killed
   `mutate:verify`, scan for a stranded mutation before anything commits.** (why:
   [rationale](references/rationale.md#3-remediate))

   Run the remediator in that worktree, then **verify it yourself**: full gate, re-read the
   diff. Never merge on a remediator's self-report.
   After each round you verify, emit `remediate settled` per round with the fixed/refuted counts in
   `--detail`.
4. **Sweep** (you, no CLI). Per thread: verify → reply with the resolution and its commit, or the
   refutation and its mechanism → resolve. Then one disposition comment per PR. A refutation is a
   first-class outcome; a silently ignored comment is indistinguishable from an overlooked one.
   When a PR's threads are all dispositioned, emit `sweep settled` with the `fixed` / `refuted` /
   `deferred` counts in `--detail`.
5. **Merge** (you). Sequential, via `hexagen-orchestration-merge-prs` — each merge invalidates the CI of
   everything behind it. If main goes red: stop, reproduce locally, ship a minimal hotfix, resume.
   **A green gate is not a merge condition on its own.** Merge only when, on the PR's *final* head:
   every check-run conclusion is success, skipped or neutral (read conclusions, not the rollup line —
   `neutral` is what informational checks report); the review bots have had time to post on that head;

   and **zero review threads are unresolved**. The merge bin **enforces this
   mechanically** — it waits a bounded settle period for the review bots, then refuses while any
   review thread is unresolved, naming each open thread — and re-reads the PR's head immediately
   before `gh pr merge`, refusing if it moved. **The settle period is a wait, not a proof the bots
   reviewed the final head** — confirm a bot actually posted on it yourself. (why: [rationale](references/rationale.md#the-merge-bin-enforces-this))

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
  one for an unrelated reason pulls it into the replay set. `hexagen-orchestration-mutate-anchors`
  checks every anchor cheaply ahead of the replay, and also checks whether the `command`'s `-t` still
  selects a test — verify it against the test file's own listing before you record it. Re-anchor
  when the code moved; retire (`"retired": "<why>"`) only when it is gone. (why: [rationale](references/rationale.md#touching-a-manifest-arms-it))

- **Before `git reset --hard`, save the diff.** Commit before you test, not after. (why: [rationale](references/rationale.md#before-git-reset---hard-save-the-diff))

- **A mutation you did not confirm applied is not a mutation.** (why: [rationale](references/rationale.md#a-mutation-you-did-not-confirm-applied-is-not-a-mutation))

- **Never `git add -A`.** The paths `config.yaml` lists as `operatorDataPaths` are the
  owner's data and are never staged by a lane.
- **Never start a dev server or curl a port `config.yaml` lists as forbidden** — those are the
  owner's live servers; a request there overwrites their output and spends their credits.
- **Run full gates in a worktree**, never in the main checkout beside a running dev server: the
  build shares its output directory and will disturb it.
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
