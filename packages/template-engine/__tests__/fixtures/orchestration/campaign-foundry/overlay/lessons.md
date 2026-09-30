# campaign-foundry's orchestration lessons

Operational lessons the orchestrator accumulated that are not in the skill, because the skill
cannot say them: each one is a thing that went wrong, in this repository, in a way the rule text
does not imply. They live in the overlay because they are consumer-specific — every one of them
names a host, a seat, a workflow or a decision that belongs to campaign-foundry and to nobody else.

Every entry carries the memory file it came from, so the original record stays traceable. Those
records live outside the repository, in the orchestrator's per-project memory, and hexagen cannot
read them; the `source:` line is what makes this file their travelling copy.

What is *not* here: the seat roster and the invocation shapes, which are `cast.md`; the
campaign-foundry-specific incidents from the skill's own rationale, which are `rationale.local.md`;
and the house rules, which are `house-rules.md`. Every memory file is either cited below or
accounted for in `coverage-allowlist.txt` — there is no third category.

## Prove the defect before you dispatch, and enumerate the fields

A lane implements the brief's enumeration, not its adjective. A brief that said to cover a surface
"in full" and then listed two of its five fields shipped a hash missing the other three, each of
which changed what rendered; a bot found it as a High. The same brief's test list omitted a field,
so the 100%-branch gate failed on the untaken arm of a conditional spread.

The second shape is worse because enumerating a type's fields does not catch it: a rule that
*compares or gates on state* was written so one side dated a lane from log mtimes and event
timestamps while the other side came from a live process and PR sweep. Two fact sets of different
ages, and the guard dropped exactly the rows an operator needs. For a rule like that, list the
inputs and their refresh cadence; a two-sided comparison collected at different times needs a
carve-out, not a threshold.

Before dispatching, open the type and enumerate its fields into the brief, write one test
requirement per field so a missed field fails a test instead of shipping, and name the parsing
hazards wherever a value comes out of a string — leading zeros, values past the safe-integer
ceiling, delimiters that can occur in the data.

source: a-brief-that-says-in-full-must-enumerate.md

## A mutation replay owns its worktree, exclusively

The manifest verifier edits source files on disk and restores them. Two replays against one
worktree clobber each other's restore and leave a mutated file on disk — and the leftover mutation
reads exactly like a real regression, because the tests are correctly catching the mutation they
exist to catch.

What makes this expensive is that the evidence looks like a paradox: one file red with three tests
failing while the full suite has just passed thousands green. The contradiction *is* the tell. Run
`git status` before diagnosing anything; a leftover mutation is far likelier than a regression the
suite missed. Save the diff before you restore anything.

Never start a replay while a gate is running, because the gate runs its own. The briefs say this;
the orchestrator has to obey it too. Two siblings from the same day: a worktree rebased past a new
dependency needs a reinstall or it fails on a missing module and reads as a merge conflict, and a
manifest's `command` is an argv array of strings, not a shell string.

source: a-mutation-replay-owns-its-worktree.md

## A push to main cancels the previous run's CI

The build job cancels in progress per ref, so a second push to `main` cancels the first push's run
— and that first run is the evidence the merge was good. Measured: a merge's CI run went to
`cancelled` because a docs stamp was pushed minutes later, which left "CI green on main after the
last merge" briefly *unknown* rather than yes.

After the last merge of a wave, wait for that push run to settle before pushing anything else to
`main`. If a run is cancelled, say so and name the superseding SHA and why its run covers the same
code. Never report a cancelled run as green.

A wait loop that watches the newest run of any workflow is not a wait: a skipped review-bot job
reported "completed" and the next push cancelled the merge's real run. Wait on the workflow *and*
on the merge's own SHA.

source: a-push-to-main-cancels-the-previous-runs-ci.md

## A green suite can be pinning the defect

When a user reports a bug the suite does not catch, grep the tests for the behaviour before
assuming a gap. Often there is no gap: an assertion encodes the defect. The guard in the failing
case was right and the affordance was wrong, and the only explanation was a tooltip a touch device
never shows — so the fix was rewriting the assertion, not adding one.

A fixture helper that keeps its fixtures internally valid can make a reachable production state
untestable, which is the same trap from the other side: no test could reach the state the user was
actually in.

Reproduce the user's *state* first, not the happy path, then check whether an existing assertion
blesses the symptom.

source: a-test-can-specify-the-bug.md

## A trivial copy change may be pushed straight to main

This repository's history is otherwise all PR merges, but for a one-line copy change the owner
commits directly on `main` and pushes. PR overhead is not worth it for a string tweak.

When asked how to land something trivial, offer the direct push as a fine default and mention the
PR as the alternative. Do not steer to a PR. Default to branch-and-PR for substantive work, and
push only when asked.

source: campaign-foundry-direct-push-trivial-copy.md

## A CI-load regression hides behind a green gate

A local gate passed at full coverage and the pull-request run passed, but the push run on the
*same commit* timed out twice. It was not a flake: the file took 65 s on main, 155 s on the
passing run and 206 s on the failing ones.

"Two runs on one SHA, one passed" reads like a flake, but a two-to-three-times duration jump is a
regression that only crosses the threshold under CI load. The pass/fail bit hides it; the
durations do not. When a timeout appears, pull the per-file durations from the failing run, the
passing run and the latest main run before re-running anything. A jump against main is the
finding, and the fix belongs in the lane — never a raised `testTimeout`.

source: ci-duration-regression-hides-behind-green-gate.md

## CI runners have no zsh, so a test that spawns zsh is blind locally

The build workflow's runners are Linux with no `zsh`. Tests that spawned `zsh` to run a shell script
passed every local gate on macOS and failed both CI runs with a spawn error, followed by a type
error from the missing output.

Any shell script a test exercises must be POSIX `sh` and spawned as `sh`. A zsh-only operator script
gets an explicit skip with the reason stated in the PR. When a lane brief adds a test that shells
out, say "spawn `sh`, not `zsh`; CI has no zsh" in the brief, and treat a locally green gate as
blind to this whole class.

Proving POSIX-ness locally needs two things the obvious check does not have: macOS `/bin/sh` is
bash in POSIX mode and still accepts `[[ ]]`, so a bashism mutant survives it. Run the script and
the mutant under `dash`, and lint with `shellcheck -s sh`. Both were assumed absent here before
being checked, and both existed.

source: ci-runners-have-no-zsh.md

## A commit's scope names the area, never the lane id

The owner asked on 2026-09-16 that commit subjects be readable by someone who does not have the
lane in hand: `feat(music-bed):`, `fix(brief-editor):`, `test(goldens):` — never `feat(ve3b1):`.

`git log` is read by people who do not have the lane. A lane id is orchestration bookkeeping and
says nothing about what changed. The drift came from lane briefs that specified a title with a
lane id in it, not from any recorded rule, so every brief that specifies a commit or PR title must
give a human-area example. Keep the lane id where someone who has the lane in context will read
it: the PR body, the session-log citation, the plan's shipped note.

source: commit-scope-is-an-area-not-a-lane-id.md

## The owner's dev servers are already running

Before starting a dev server or curling anything, check what is listening and when it started. The
owner usually has the web app and the API live on 3000 and 3001 from the main worktree. A dev
server that fell back onto an occupied port means every request went to *their* server, which
overwrote the current run's report, added stray output files and overwrote generated creatives.

This is the origin of two house rules: never curl a forbidden port, and run full gates in a
worktree rather than in the main checkout beside a running dev server, because the build shares
its output directory with it. Both are in the skill as rules; the cost is recorded here.

source: dev-servers-already-running.md

## Markdown is not gate-covered, and Prettier on a plan is churn

The format check globs `**/*.{ts,tsx}` only. Running Prettier over a planning document reflowed
every row of its tables — 137 changed lines over about twenty lines of real prose — and a reviewer
then filed a finding against `§` usage on lines that were pre-existing content Prettier had merely
re-wrapped. A whole reply cycle went into refuting a finding the formatting had manufactured.

This is why a verbatim snapshot directory has to be Prettier-ignored rather than merely
well-formatted: the bytes are the evidence, and the evidence is what the comparison reads.

source: format-check-covers-only-ts-tsx.md

## A zero-hit grep proves nothing until it finds a known positive

On macOS `git grep -E` treats `\b` as matching nothing, so a plan's acceptance grep and its
lane-prefix check passed on *any* tree. A shipped plan carried both vacuous greps; a review caught
it.

The second trap is the same shape: a quoted pathspec like `'packages/*/src'` matches zero files,
because git's fnmatch needs the whole path, so any grep scoped with it passes vacuously too.

Use `-P` or `-w`, scope with `:(glob)…`, and confirm a known positive with the *identical* pattern
and pathspec before believing a zero. This is the same discipline the coverage check in this
fixture is built on: a check that cannot fail is not a check.

source: git-grep-e-word-boundary-is-silent-on-macos.md

## Liveness is the exit marker, and only the branch is evidence

A live lane streams — a working log passes hundreds of kilobytes within a minute — so a 0-byte log
after about thirty seconds with no process is a dead lane, not a slow one. But a quiet log is also
not a dead lane: one can go a minute without writing while a long tool call runs. Two independent
signals work: the lane log growing, and the CLI's own log carrying the worktree's path. If neither
moves, the lane never reached the model at all.

The trap that costs the most: a seat reporting `EXIT 0` **and** `"status":"SUCCESS"` having
committed nothing. One lane ran 359 seconds, spent 643k tokens, and its entire response was that it
had started the test suite in the background and would wait for it. The JSON status is not
sufficient evidence either. `rev-list --count origin/main..HEAD` and a real pull request are the
evidence, and a monitor keyed on the exit marker alone reports all of this as success.

The detached launcher this replaced killed the lanes it started — it stayed in the caller's process
group and the harness signalled the whole group — so lanes are launched directly, from a tool call
that returns immediately, with an absolute brief path.

source: lane-liveness-only-the-exit-marker.md

## A lane can ship ahead of the decision that authorised it

Twice, a lane merged while its decision was still unstamped, and once while a required pre-check was
still undone. The owner stamped both afterwards.

The orchestrator's intake reads the plan's lane table; the decision gate sits in a different
section, so a lane that "looks ready" gets dispatched and the plan's status line then contradicts
the tree. Before dispatching or merging, grep the lane's decision ids for `STAMPED` in the plan
itself, not just in the lane row. If it is not stamped, ask. Never infer approval from "finish the
work". If it already shipped, record it as shipped-unstamped, name any skipped pre-check as open,
and ask — do not backfill a stamp.

source: lane-shipped-ahead-of-its-decision.md

## Run suites in a worktree, never in the main checkout

The main checkout's root env file points the store layer at a live database service, and the config
loads the environment before choosing a backend, so a test run there selects the real stores. A
timing comparison run from the main checkout nearly connected to it.

Run tests, timings and mutations only in a lane or scratch worktree. For a main baseline, check out
the SHA inside a finished lane's clean worktree and switch back. This is the same rule as running
gates in a worktree, and for a sharper reason: the main checkout is the one directory that has both
the operator's environment and their dev servers in it.

source: main-checkout-tests-read-operator-env.md

## Never hand the merge script the main checkout

The merge script refreshes a pull request inside the worktree you name and then pushes that HEAD to
the PR branch, and afterwards removes the worktree. Naming `.` — the main checkout, which by then
is back on `main` — would have pushed main's HEAD over the PR's branch and wiped the change. It was
caught by reading the script before the queue reached that PR.

The worktree field means "the lane's own worktree, on its branch", and the script trusts it. For a
branch with no dedicated worktree, leave the field empty and the script refreshes in a throwaway
detached worktree. Never pass `.`.

It also uses zsh parameter flags, so both `sh` and `bash` fail with a syntax error — and because
that happens before anything merges, the exit looks like a refusal. Two attempts were wasted on it.

source: merge-prs-never-pass-the-main-checkout.md

## Check the assertions you prescribed yourself

Assertions the *orchestrator* writes into a lane brief can themselves be the vacuous tripwire, and
the lane will implement them faithfully and report the mutation as red for a different reason. Two
found in one wave: an event assertion that could never go red because the test DOM defaults the
event to non-cancelable, and a `waitFor` on a condition that was already true, which returns
without yielding, so the assertion after it ran before the framework committed — passing against the
very bug it pins.

A third case had no pin at all: deleting both guards left a ten-test block green while the lane's
report listed mutation checks as passing, because they exercised other lines.

A lane's "mutation red" is evidence about the mutation the lane ran, not about the assertion you
care about, and a reviewer's clean approve is not evidence either. For any test the orchestrator
prescribed, break the source yourself, watch that named test go red, restore. If it stays green,
the test is the defect. Mutate one thing at a time and keep the structure intact, so an unrelated
failure does not drown the signal: too many tests failing means the mutant is too blunt, none
failing means the test is decorative.

source: mutation-check-the-orchestrators-own-brief.md

## Mutate the source, not only the values

Before claiming a test covers a behaviour, break the behaviour and confirm the test fails. And when
a test asserts that its numbers match a domain function's, replace the *call* with a hand-rolled
equivalent rather than passing a wrong value — the assertion was checking the numbers, not the
delegation, and for an ordinary input the two agree exactly, so it passed.

The same round produced a coverage lesson: a real fix can be uncovered while the file reads 100%.
It only became visible after searching for inputs where the two formulas actually disagree — a
floating-point case where the obvious fixture was not the interesting one. Write a probe to find
the disagreeing case rather than assuming an obvious fixture exercises it.

source: mutation-test-the-test-not-just-the-code.md

## `git add -A` here publishes the operator's data

The operator's campaign briefs and generated assets are untracked and unrecoverable. A broad stage
swept four briefs and two logos into a commit and pushed them to a remote. An ignore rule now
backstops the two known directories, and the sample fixtures stay tracked — but the backstop is not
a licence, because an ignore rule does not cover a path someone later adds elsewhere.

Always stage explicit pathspecs, and read `git status --porcelain` before every commit. If it has
already happened, rewrite the branch: a removal commit hides the files from the diff but leaves the
blobs in history. Whether those directories should be ignored at all is the operator's call —
offer, do not do.

source: never-git-add-all-in-main-checkout.md

## No attribution trailers, and grep for every form of one

The owner does not want the generated-with line, the session URL, or a co-authored-by trailer in
commits or pull-request bodies — stated after fifteen PRs had accumulated them, and all fifteen were
stripped.

A direct instruction from the owner outranks a session-start reminder that asks for one, which is
exactly why lanes keep adding them: they are told to, notice, and cannot always amend afterwards.
And the obvious grep is not enough — a pre-merge check for two spellings reported zero while a
third form reached main. Check every form, over every lane branch's commit bodies, and again on
main after each merge. Trailers already on main are left alone: stripping them means rewriting
published history, which was not asked for.

source: no-ai-attribution-in-prs.md

## The model server is shared, and three ports are off limits

The owner runs one long-lived model server shared by four projects, on loopback, and starts it
themselves. Attach to it with the worktree's absolute path as the working directory; a run that
waits on stdin never reaches the model, so redirect stdin on every invocation.

Check the server is up first, and if it is down ask the owner to restart it. Do not start one
yourself: it has to outlive the session. Never bind 3000, 3001 or the wave-status port — those are
the operator's, and a request to one of them spends their credits and overwrites their output.

Two older rules here were corrected rather than kept: "never two runs at once" applied to
standalone runs that each started their own embedded server, and the claim that no process listing
ever shows a live lane was concluded on a day the lanes were genuinely dead from a broken launch.
Check the process and the worktree, and do not generalise from a broken run.

source: opencode-shared-server.md

## Planning documents are not progress

Days were lost to work that was planned, written up in detail, and never dispatched — while being
reported as progressing. It went undetected because when the owner said the UI had not changed,
every plausible explanation sounded mechanical, and each was investigated and correctly refuted.

The detectable signature is a status report full of decisions, plan sections and documents with no
pull-request URLs in it. Before reporting any lane as progressing, list its PRs: no PR means stage
two never started, and stage two is the only stage that finds defects. When the owner says a change
is not visible, check whether the work was ever dispatched *before* theorising about caches,
builds or CSS.

source: planning-docs-are-not-progress.md

## A scheduled lane may already be closed, or blocked

Three of six scheduled lanes in one wave pair were not lanes: one was fixed by a merge two days
before it was scheduled, one sat behind a decision still written as a later extension, and one was
already shipped by a decision the plan itself recorded.

The inventory that scheduled them used `merge-base --is-ancestor` over *cited* pull requests. That
proves what shipped and cannot see a closure or a blocker it did not cite, so a stale "open" row
survives it untouched.

Before building any scheduled lane: check the log for the test file a fix would touch, grep for the
defect's own numbers, and read the source plan's own status line. An inventory is a starting point,
not a premise.

source: scheduled-lane-may-be-closed-or-blocked.md

## A scoped coverage run is not the gate's number

A lane reported per-file 100% from scoped coverage runs; the gate then failed at 99.99% on three
uncovered branches. The scoped run's include path contained parentheses, which are glob syntax, so
it matched nothing — and printed "All files | 0" with no error, which is easy to misread as "no
gaps".

The threshold is global, so a run measuring a different set of files proves nothing. Scope with a
glob that avoids shell-special characters, read the file's own row from the JSON summary, and
**check the row exists before believing its numbers**. Treat a per-file claim as unverified until
the row is shown. This is the rule the skill carries as "measure coverage the way the gate does".

source: scoped-coverage-must-match-the-gate.md

## Keep lane PRs small enough to review

A delegated lane must produce small pull requests; split a plan lane across several rather than
letting one become one large one. The evidence is in this repository's own history: the lanes that
shipped as single large pull requests each carried serious findings that survived only because the
diff was too big to read closely — a path traversal, a rejected-write ordering bug, a drawer no
production code rendered, a thumbnail wired to a path nothing serves. Each passed its own
full-coverage gate.

When writing a brief, group the plan's task rows into reviewable batches and tell the lane to open
one PR per batch, gating and pushing each before starting the next. Prefer a seam a reviewer can
reason about — domain, then API, then editor — over an arbitrary row count.

source: smaller-prs-per-lane.md

## Squash-merge folds every commit body into main

A pull request with a clean body still lands attribution trailers on main if any individual commit
carried them, because the merge message is the PR title plus every commit body, plus an
auto-generated co-author line.

It went unnoticed because the prediction that squash-merging drops them was repeated without
checking; it is false. An audit found eight of twenty-four commits on main carrying trailers, up to
eleven hits in one squashed commit.

Merge with an explicit subject and body, or verify afterwards on the merged commit's body — checking
the PR body is not sufficient. Lanes should run that same check over their own branch's commit
bodies before reporting done.

source: squash-merge-concatenates-commit-bodies.md

## Test temp directories leak and fill the disk

A wave hit ENOSPC: every shell call failed, for the orchestrator and every lane alike. It was not
the worktrees — a few hundred megabytes each, hardlinked — it was thousands of leftover test
directories in the temp directory, several gigabytes, because those suites create one per run and
remove none. Every coverage run and every mutation replay adds more, across every session.

A second cause found the same day: the gate lock serialised full gates only, so targeted runs and
mutation replays across six lanes pushed the host to a load of 90–121 and the coverage run then
failed with unrelated timeouts.

Before a parallel wave, check free space from the command line and prune stale test directories
with an age filter so directories in use are spared. Put mutation replays and multi-file test runs
under the gate lock, not only the full gate.

source: test-temp-dirs-leak-fill-the-disk.md

## `typecheck` is green on type errors inside package tests

The typecheck task reported success on a tree whose new test file had two type errors; the lint
task failed, because it triggers a build that typechecks the test directory.

This is the gate-asymmetry family: a gate that passes without checking looks identical to one that
checked and approved. After writing a new test file in a package, do not trust typecheck as the
type gate — run lint, or the package's build, before believing the types hold. It matters most for a
lane whose new tests construct a domain type by hand, where the required fields are invisible until
the build runs.

source: typecheck-skips-package-tests.md

## Use jq and node, never python

The owner asked on 2026-09-18, after noticing Python in the transcript: `jq` for JSON and `node -e`
for text surgery, no python heredocs. This is a TypeScript monorepo whose tooling, manifests and
verification CLIs are all TypeScript, so python is a foreign idiom in a repo that already has two
better-fitting tools — and it makes the work harder for the owner to read and re-run.

Nothing leaked into the repository, but it did cost something: a python edit to a planning
document's decision table split a row on its pipe and rejoined it, breaking the column padding, so
the document read *open* in its status cell while its header and the commit message both said
stamped. Self-contradictory, which is the exact defect class that session was spent removing from
other people's documents.

source: use-jq-and-node-not-python.md

## Verification follows signal, not habit

The owner said on 2026-09-08 that too much time was spent verifying work that turned out to be
nonsense. The record agrees: across a run of pull requests, one review bot left about thirty
comments and nearly every one was refuted at the cost of a read, a verification, a reply and a
resolve. The defects that mattered came from the other bot, from the orchestrator's own gate, and
from CI.

Verification is the expensive step now, so it has to follow the hit rate. Bulk-resolve the
near-zero-source threads with one line and read them only if the PR's own claims fail. Spend model
review on lanes that change rendering, the kit or user-visible behaviour, and give a domain or
boundary lane the gate plus one mutation instead. One orchestrator mutation per pull request, with
the diff printed before the run, and a second attempt only if the first did not apply. No fix round
for nit-level items.

source: verification-budget-follows-signal.md

## Verify the caller, not just the component

A component gained a prop, gained a fallback for when it is absent, and its tests pass the prop
directly — while nothing in the application ever passes it, so the fallback is what actually runs.
Measured: the only path from the resolved look to the frame was never changed, and the cell fell
through to inferring identity from appearance, which agrees with the client only by coincidence and
picks the wrong item outright when two share a colour. Right colour, wrong logo.

It is invisible because every component-level test is green and honest about its own component. One
grep over the non-test call sites settles it. A prop nobody passes is indistinguishable from a
prop that does not exist.

source: verify-the-caller-not-just-the-component.md

## A dependency's node export condition can void a whole suite

The test runner resolves modules in a server-side environment, so a dependency's `node` export
condition wins over its browser one. A package whose node build is a server-render stub therefore
gets loaded in place of the real implementation, and the entire suite measures nothing while
reporting green.

The suite is not failing, so nothing surfaces it. When a suite passes suspiciously easily against a
dependency, check which export condition it actually resolved before believing the result, and
pin the browser condition explicitly when that is the one under test.

source: vitest-resolves-the-node-export-condition.md

## Lane worktrees live in one folder, and the disk is checked with df

Every new lane worktree is created under a single folder the owner excludes from backups, and the
briefs name that absolute path. Throwaway worktrees carry about 0.9 GB of `node_modules` each; the
owner moved backups from hourly to daily specifically to stop shipping them.

The same day the disk filled, an uncompressed archive of the projects crashed at ENOSPC and killed
a lane and a paid review. Check free space from the command line before parallel lanes — the
graphical viewer's figure counts purgeable local snapshots, so it read 268 GB free while the
command line reported 63 GiB.

source: worktrees-location.md
