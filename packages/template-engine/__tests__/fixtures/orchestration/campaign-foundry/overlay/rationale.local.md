# campaign-foundry rationale

The incidents the scrub removed from `generic/references/rationale.md`, kept here **verbatim**.
The generic rationale keeps each rule — what to do and why it is not optional. What cannot travel
is what happened: a lane id, a pull-request number, a seat that burned a quota, a file this
repository happens to own, a date. That record is campaign-foundry's, and it is what a reviewer
reading the overlay is actually reading.

Each block below is the source's own text, reproduced byte for byte from the pinned snapshot, with
the line range it came from named beside it. The coverage check in
`scripts/orchestration/skill-coverage.mjs` is what proves nothing was lost on the way: every
paragraph and every heading in the snapshot has to appear, whole, in this overlay or in the generic
skill, and no source unit may be allowlisted away.

## Cast authority and the identifier grammar

From `source/references/rationale.md` lines 10–17 — the seat roster as the source states it, and the deleted launcher.

- **The current seats are in `references/cast.md`, and it is the authority** — this file does not
  restate them, because it drifted once already: it named `agy gemini-3.8-flash-high` as the
  implementer long after the roster moved to `openrouter/qwen/qwen3.8-flash` primary with gemini as
  the reserve. Whatever the seat, **record the worktree tip first** and watch the provider's quota.
  Reviewers stay in-house: a second `Agent` that is **not** the implementer. There is **no lane
  launcher**: `scripts/dispatch-lane.sh` was deleted on 2026-09-17 because its detached launch killed
  the lanes it started (the mechanism is in the Implement stage, below). Launch every lane yourself
  and emit its event in the call immediately before — `scripts/wave-event.sh` is the emitter.

From `source/references/rationale.md` lines 23–25 — the identifier grammar, by the project script's name.

`wave-event.sh` accepts `[A-Za-z0-9_-]+` for both, so an identifier can carry the plan's id **and**
say what the lane does. Use both — the id is what a PR, a record and the plan agree on; the name is
what a human reads on the status page at a glance.

From `source/references/rationale.md` lines 27–30 — the identifier examples, with this project's own lane and wave ids.

```text
wave:  <plan-slug>-w<NN>       creative-templates-w03
lane:  <plan-id>-<what-it-does>  L3b-layer-props   L7a-template-library
```

From `source/references/rationale.md` lines 34–36 — the two bare ids the source rejects by name.

**Not** `ct-3/L3b`, and not `waveT/fix-a4`. A reader six weeks out has no idea what `A4` was, and
the id alone makes the status page a lookup table against a planning document. Keep the id first so
sorting still groups a plan's lanes in order.

## Mutation

From `source/references/rationale.md` lines 40–40 — the section heading, naming the yarn alias.

### Run mutations through `yarn mutate`, not by hand

From `source/references/rationale.md` lines 42–46 — the tool's guarantees, with the yarn alias.

**Run mutations through `yarn mutate`, not by hand.** The tool takes the before- and after-text
from **files**, so no shell quoting can alter them; matches **literal text with no regex**; refuses
unless the text occurs exactly once; refuses a no-op; confirms the file holds the **intended**
mutation before running anything; restores unconditionally, loudly if the restore itself fails; and
reports the command's **exit code first**, with the verdict in words:

From `source/references/rationale.md` lines 50–55 — the two exit codes, with the yarn alias in the worked example.

**Two exit codes are in play; do not confuse them.** The **test command's** code is what decides the
verdict — non-zero means the mutation was caught, zero means it survived — and the tool prints it as
the report's first line. **The tool's own** code is the verdict already reduced for a caller to gate
on: **`0` caught, `1` survived, `2` refused**, and a refusal names the rule that refused. So a
caught mutation shows `exit code: 1` in the report while `yarn mutate` itself exits `0`. That is
deliberate: the harness exits zero when it did its job.

From `source/references/rationale.md` lines 85–87 — the dispatch wrapper that reported commits per lane.

**The dispatch wrapper now reports commits per lane** against the tip it recorded before dispatch,
and distinguishes *no commits* from *could not tell*. Read that line; it is the mechanical form of
the rule below.

From `source/references/rationale.md` lines 99–101 — PR #287, the branch that carried the earlier round's commit.

PR #287 is the case that makes this concrete: its branch carried the earlier round's commit as well
as the fix, so `origin/main..HEAD` would have looked healthy even if the second round had written
nothing at all.

From `source/references/rationale.md` lines 103–106 — PR #282, merged with four verified defects still in it.

Four lanes in one session exited `0` having written nothing — two answered with a plan, two read
files and stopped. **PR #282 was merged with four verified defects still in it** because its fix
round reported success and committed nothing. An exit code is not evidence of work, which is the
same rule this file already applies to lane reports.

From `source/references/rationale.md` lines 118–122 — the seat that reported success having committed nothing.

**Run the commit count first, and do not skip it because the seat said `SUCCESS`.** A seat's own
verdict is not evidence of work: on 2026-09-19 an agy lane reported `EXIT 0` *and*
`"status":"SUCCESS"` after six minutes and 643 k tokens, having made **zero commits** — it launched
the test suite as its first act and narrated waiting for it. `cast.md` carries the detail. Zero
commits is a stuck lane no matter how the run describes itself.

## The gate

From `source/references/rationale.md` lines 133–133 — the section heading, naming the byte-scan alias.

### yarn lint:bytes

From `source/references/rationale.md` lines 135–141 — the byte-level scan step, by its project alias.

**`yarn lint:bytes`** is in the gate above rather than in this list, deliberately. It scans ~920
files for raw C0 control bytes in about 100 ms, and it exists because a raw `\x00` inside a string
literal once survived `build`, `typecheck`, `lint`, `format:check` and 6,103 tests — nothing else in
the gate set looks at bytes, and it was caught only because a mutation anchor stopped matching.
Unlike `install --immutable` it is cheap and runnable locally, so a lane should meet it before CI
does. **Note it is NOT inside `yarn typecheck`** — that chain type-checks the tool, it does not run
the scan; `yarn typecheck` on a tree containing a raw NUL exits 0, measured.

From `source/references/rationale.md` lines 143–143 — the section heading, naming the route-scan guard.

### The other two: check:env and the Nitro route-scan guard

From `source/references/rationale.md` lines 145–149 — the conditional no-op and the route-registry guard.

The other two: `check:env` (a conditional no-op here — no such script exists) and the
**Nitro route-scan guard**, which runs `nitro prepare` and fails if a `*.test.ts` file has been
registered as an API route. Its own comment in `ci.yml` says it catches "a runtime fault the build
and coverage gate don't catch". **A lane that adds or moves a test file under `apps/api/server/`
must also run:**

From `source/references/rationale.md` lines 163–169 — the which-gate table, with this project's aliases and workflow step.

| Gate | Enforced by |
|---|---|
| `yarn plan:verify` | **CI.** A lane dispatched against a closed gap fails the build. |
| a lane retiring its own premise | **CI**, as a consequence of the above: a shipped lane that leaves its fence behind fails its own PR. |
| `yarn mutate:verify` on a **changed** manifest | **CI** (`scripts/verify-manifests.sh`). |
| **a manifest existing at all** | **you.** Nothing can require one without punishing the docs PR, the refactor and the premise audit that legitimately have none. It is a line in every lane brief, and it stops being applied the moment an orchestrator forgets to write it. |
| `yarn handoff:check` | **you**, when you set up a two-stage lane. |

## Before you dispatch

From `source/references/rationale.md` lines 175–182 — the two-stage handoff rule, with its yarn alias.

**A two-stage lane hands over a handoff file, not a claim.** Stage 1 writes
`.agents/handoff/<lane>.json` binding every rule in its brief to the test that pins it, and
`yarn handoff:check` refuses the handoff unless **every rule names a test that exists and is
currently failing**. A missing rule caps the implementation at stage 1's completeness and leaves no
trace in coverage; a test that already passes pins nothing, because stage 2 can satisfy it by
changing nothing. Both have happened: one stage-1 author wrote twelve tests for eight states, missed
three conditions from its own brief, and the lane shipped reporting a failing PR as `merged` at
100 % coverage.

From `source/references/rationale.md` lines 196–201 — the three seats that answered a probe and died on a real lane.

3. **Prove each seat with a trivial DISPATCH, not a chat probe — and give a failing seat one
   attempt per wave.** A one-word probe measures the wrong thing. On 2026-09-16 `opencode`'s
   `big-pickle` and `qwen3.8-flash` both answered `ready` and then wrote **0 bytes with no process**
   on a real lane; `qwen3-coder` errored outright. Three failures, three model ids, one broken run
   path — while `agy` (a different binary) ran first time, which is what located the fault. A probe
   that passes and a dispatch that dies look identical until you spend a cycle.

From `source/references/rationale.md` lines 203–210 — the probe artefact, the deleted wrapper, and the install that was wrongly skipped.

   So: prove a seat by asking it to edit a scratch file in the lane worktree and exit, then check
   the file changed — **and delete it before dispatching the lane, verifying the tree is clean
   again.** A probe artefact left behind is worse than no probe: `git status --porcelain` in that
   worktree is what the next step reads to derive lane status, so an untracked scratch file reads as
   lane activity, and a lane that later stages with a broad pattern can commit it. Found by two
   reviewers independently on the PR that introduced this rule. And when a seat fails a real dispatch, **switch rather than debug** — one
   attempt per wave. Two extra cycles were spent on 2026-09-16 rediscovering a rule written after
   the first failure.

From `source/references/rationale.md` lines 214–229 — the lane-id collision rule, with the two plans it was found in.

   - **Grep the lane id against every plan, not only its own.** `grep -rniw '<ID>' docs/planning/`
     is one command and it is the whole check. Match on word boundaries, **not** on `**<ID>**`: ids
     are written `| **C4b** |` in a table, `**Lane C4b**` in prose and bare in a sentence, and a
     pattern that assumes one spelling reports "no collision" for the two forms it cannot see —
     which is worse than not running it, because it is evidence that is not evidence. Lane ids are the join key for the session-log
     citation, the plan's shipped note, the mutation manifest filename
     (`.agents/manifests/<lane>.json`), the wave-status row and the premise fence's own name, so a
     collision silently merges two lanes' histories and `plan:verify` can evaluate one plan's fence
     against the other's claim. It has happened twice: `TL1` named both the template-library routes
     and "one playhead, two positions preserved" in plans written the same day, and `L10`/`L11`
     collided between the templates plan and `run-exclusion-and-the-second-surface`. Both times the
     colliding ids were **bare sequential** ones; prefixing with the plan's arc (`L7a2`, `CC5`,
     `SE3`) is what has kept the other arcs clean. (`the-unowned-gaps.md` §42.)
     The `L10`/`L11` collision is also recorded at `studio-editor.md`'s finding **C2**. BSD `grep -E`
     has no `\b`, so the original word-boundary pattern (`grep -rniE '\b<ID>\b'`) was silent on every
     tree here — `-w` is the portable way to match a whole word, which is why the command above uses it.

From `source/references/rationale.md` lines 233–239 — the ceiling overcount that a merged fix had already corrected.

   - **Check the gap is still open before dispatching the lane that closes it.** A recorded finding
     is a claim about the past. `git log --oneline -- <the test file the fix would touch>` and a
     grep for the defect's own numbers cost seconds; re-deriving an inventory with
     `merge-base --is-ancestor` does **not** cover this, because that method proves what shipped
     and cannot see that a recorded gap was closed by something it did not cite. RW-24 was
     scheduled on 2026-09-20 against a ceiling overcount that #499 had fixed on 2026-09-18, with
     the reported 48-against-32 numbers pinned in a test named after them.

From `source/references/rationale.md` lines 241–241 — the section heading, carrying the date.

### Four defects on 2026-09-16 came from briefs that failed exactly this

From `source/references/rationale.md` lines 243–254 — the four defects, with their lane ids and field names.

   Four defects on 2026-09-16 came from briefs that failed exactly this, and in every case the lane
   implemented what was written:
   - X33's copy hash was told to cover "`copy.timeline` **in full**" against a list naming two of
     its five fields — `beat.weight`, `transition` and `keyBeat` were omitted, each of which
     changes what renders. Found by a bot as a High.
   - X33's test list omitted `localizedMessage`, so the 100%-branch gate failed on the untaken arm
     of a conditional spread — a field the hash *did* cover but nothing proved reached it.
   - The template-routes brief named no precision hazard, so a version past the safe-integer range
     could resolve to a **different stored version than the caller pinned**.
   - X38 was briefed as "a past-wave lane is not counted as needing a human" — true as a sentence,
     wrong as a rule, because age came only from log and event timestamps while liveness and PR
     checks were live-probed. Two fact sets, different ages, no carve-out.

From `source/references/rationale.md` lines 266–266 — the section heading for the fences that failed.

### 8. Every fence you write must be TIMED and shown to decide, before it lands (three fences that failed)

From `source/references/rationale.md` lines 268–277 — the three fences that failed, by lane id and file count.

   Three fences failed this way on 2026-09-16, each differently, and the pattern is worth knowing:
   - **Too slow.** SE2 flattened a 100 kB file with `tr` and ran `.{0,700}` against the single
     resulting line — catastrophic backtracking, killed at 10s. Bounded to the function body with
     `sed -n '/^function name/,/^}/p'`, it answered in ~7 ms.
   - **Too narrow.** X1 asked whether a Prettier config existed — half of its own section's title,
     and the half that closes first. It went STALE on the config-only commit while 400 files were
     still unformatted, which would have forced a 400-file single commit.
   - **Too slow again, from the opposite direction.** X1's replacement ran `prettier --check` over
     679 files: 4.8s locally, TIMED-OUT on the runner. Local timing is not the test; the runner is
     slower and contended.

From `source/references/rationale.md` lines 281–287 — the plan reviewer's model id and the counter it caught.

9. **Send the plan to the plan reviewer** (`Agent` · `subagent_type: "Plan"` · `model: "fable"`)
   **before dispatching any lane from it**, whenever the plan *introduces or rewrites lanes* or
   *changes a premise*. It is read-only by construction, so it returns a review and cannot patch
   around what it finds. On its first use it caught a rule in an **already-dispatched** brief that
   contradicted both the plan and the code — `restT` per track, where `REST_T` is per motion kind —
   which the lane would otherwise have pinned in a test. The lane was stopped with nothing committed.
   Nothing else needs this seat; it is not a review gate on prose.

## The six stages

From `source/references/rationale.md` lines 293–299 — the two dev-server native binaries that went missing.

   Yarn Berry hardlinks package contents from a shared global cache. Concurrent installs across
   worktrees can evict or relink an entry while another checkout is holding it, and the victim is the
   checkout nobody is installing into: the **main checkout**, which silently loses a native binary
   while keeping the package directory. Twice on 2026-09-17 this broke the owner's `yarn dev` —
   `@next/swc-darwin-arm64` and then `@napi-rs/canvas-darwin-arm64`, each left with its
   `package.json` and `README.md` intact and its `.node` file gone. Platform-specific optional
   dependencies are what break, because they are the large binaries.

From `source/references/rationale.md` lines 301–307 — the install-skipping rule, with the lane id whose install was wrongly skipped.

   So: serialise installs; skip them **only for a lane that runs no local command needing
   dependencies** — which in practice means a docs-only lane and very little else. **A deletion lane
   is not one of them**: W1 deletes a test file, and proving the *remaining* suite still passes is
   exactly the command that needs `node_modules`. (I skipped `cf-w1`'s install on the strength of the
   first draft of this rule; review caught it before the lane ran.) And
   **after a wave's installs, verify the main checkout still has its native binaries** rather than
   letting the owner's next dev start find out:

From `source/references/rationale.md` lines 311–314 — the two stripped binaries the check found.

   Run on 2026-09-17 it found **two more** beyond the two that had already broken `yarn dev`:
   `@turbo/darwin-arm64` — which is why that day's dev run opened with *"Turborepo did not find the
   correct binary for your platform"* and repaired itself — and `@rolldown/binding-darwin-arm64`,
   which nothing had asked for yet and would have failed later, with no obvious cause.

From `source/references/rationale.md` lines 318–324 — the two lanes that committed and never opened a PR.

   **A lane is not done until the PR exists, and lanes routinely stop one step short.** On
   2026-09-16, CC1 and CC6 each committed clean, verified work and never pushed or opened a PR, and
   CC1 paused four separate times mid-`mutate:verify` waiting on its own background job. Write
   "commit, push, and open the PR with `gh pr create`" as the explicit final instruction in every
   brief — and when a lane stops anyway, **finish it mechanically yourself** after verifying the
   diff. That is a legitimate orchestrator action, not a fix the lane owes you; what is not
   legitimate is reporting the lane done because it said so.

From `source/references/rationale.md` lines 328–343 — the event-emission mechanism, with the project script paths.

   Emit the event in the tool call **immediately before** the launch, with nothing between them —
   never afterwards, and never "as you go", which is what an orchestrator reads and skips. It cannot
   literally be the same call on the primary path: an `Agent` dispatch and a Bash call to
   `scripts/wave-event.sh` are different tools by construction, so a rule demanding one call is
   unfollowable, and an unfollowable rule teaches that rules are optional. The property that matters
   is that **no lane is ever launched without its event already written**; the adjacency is how you
   get there. **There is no launcher that emits for you, and there will not be one.** A script that
   emitted and launched in one call existed until 2026-09-17 and was deleted: it killed every lane it
   started on 2026-09-13, and again on 2026-09-16, when both lanes dispatched through it wrote 0 bytes
   with no process while every directly-launched lane that day worked. **The mechanism, so nobody
   rebuilds it:** `nohup` only ignores `SIGHUP` and `disown` only drops the shell's job-table entry —
   neither calls `setpgid`, so a lane launched that way stays in the **caller's process group**. A
   launcher that then *waits* holds the tool call open past its timeout, and the harness signals the
   whole group, taking the lanes with it. A direct `nohup … & disown` survives precisely because the
   tool call **returns immediately** and a finished call is never group-killed. Atomicity bought this
   way costs the lane; adjacency from a direct launch is the supported shape.

From `source/references/rationale.md` lines 345–349 — the wave that produced one event in total.

   Emission is therefore yours. On 2026-09-16 four of five lanes ran through the `Agent` tool or a
   direct CLI and nobody emitted for them, so the wave-status page showed **one event for the whole
   wave** and 30+ events had to be backfilled afterwards with a note that their timestamps were
   recording times, not event times. A stage with no event did not happen, and a backfilled one
   cannot be trusted for timing.

From `source/references/rationale.md` lines 353–362 — the checkpoint rule, with the provider failures that proved it.

   **Every brief carries the checkpoint rule**: commit the failing tests locally the moment they have
   been seen to fail, commit again after each green step, push only when the gate passes. On
   2026-09-13 provider failures (one 522, six 429s) killed seven lane runs. The two that had written
   nothing to disk lost the whole run; every other one resumed from what it had committed — or, once,
   from uncommitted files that happened to survive in the worktree, which is luck, not a method.
   **This is a scoped exception to `.agents/testing.md` ("a red suite blocks the commit"), confirmed by
   the owner on 2026-09-14,** and it covers checkpoint commits on a lane's own branch only. The branch is
   pushed only when the gate passes on its head, so no pushed head and no CI run is red; the red
   checkpoints do travel to the lane branch on `origin` as history, and never reach `main`, because PRs
   squash-merge. Do not rewrite history to hide them — that is the destructive step checkpoints prevent.

From `source/references/rationale.md` lines 374–374 — the section heading, naming the project script.

### scripts/merge-prs.sh enforces this

From `source/references/rationale.md` lines 376–389 — the merge gate, with the settle-period flag and the sweep tool path.

   and **zero review threads are unresolved**. **`scripts/merge-prs.sh` enforces this**: once the
   required check has concluded green on the head it pushed, it waits a bounded settle period for the
   review bots (`REVIEW_SETTLE_SECONDS`, default 120, refused unless a whole number), then refuses to merge
   while any review thread is unresolved
   — naming each open thread's first-comment author and an excerpt — and re-reads the PR's head
   immediately before `gh pr merge`, refusing if it is no longer the SHA whose checks were read. The
   decision itself lives in TypeScript (`tools/sweep`, `yarn sweep gate --pr <n> --sha <sha>`), because
   it has to be tested and the runners have no zsh; the script is only its caller. A page of threads
   that could not be read is "could not decide" and refuses — never a silent zero (X13).
   **The settle period is a wait, not a proof that the bots reviewed the final head.** Only bots that
   re-run on push (Qodo, CodeRabbit) can post on a refreshed head; the PR-Agent workflows trigger on
   `opened`/`reopened`/`ready_for_review` only, and nothing checks that any bot ran. The script enforces
   two things — no unresolved threads and an unchanged head — and a PR whose final head deserves a bot's
   eyes still needs you to confirm the bot posted on it.

From `source/references/rationale.md` lines 391–391 — the section heading for the evidence.

### scripts/merge-prs.sh enforces this (evidence)

From `source/references/rationale.md` lines 393–395 — the merge that raced the review bots.

   On 2026-09-13 a merge gated on CI alone raced the bots — nothing was missed that time, but only by
   luck — and the full condition later held back a PR whose final-head review found a real defect
   the gate could not see.

## House rules

From `source/references/rationale.md` lines 401–409 — the paid seat used to prove the process-group kill.

- **Never spawn a funded model seat to reproduce a defect.** `opencode run`, `agy`, `grok` and the
  rest bill the owner. On 2026-09-17 lane W1 demonstrated the launcher's process-group kill by
  launching one real `opencode run` against the owner's account — about four seconds of a paid seat,
  disclosed unprompted, for a fact a stub would have shown just as well. The dispatch mechanics being
  probed (does the child survive a group signal?) are a property of `setpgid`, `nohup` and `disown`,
  not of any model: `sleep 60` reproduces them exactly. The existing rules named the owner's dev
  servers and their GenAI credits and did not name this, so write it into every brief: **reproduce
  dispatch and launcher behaviour with a stub process, never a paid CLI.** A seat is for doing the
  lane's work, not for demonstrating that a launcher kills it.

From `source/references/rationale.md` lines 413–418 — the manifest rule, with the workflow step and its environment variable.

- **Touching a manifest arms it.** CI replays only the manifests a change *touches* — the
  **`Replay changed mutation manifests`** step in `ci.yml`, which runs `scripts/verify-manifests.sh`
  against `MANIFEST_DIFF_BASE` (named, not cited by line: a line number in a rule about anchors
  rotting is the joke writing itself) — so editing one for an unrelated reason pulls it into the replay set and every
  anchor in it must then resolve. On 2026-09-17 lane TS1 re-anchored two entries in `cc1.json` and
  turned its third — stale since X1's formatter run — into a red gate.

From `source/references/rationale.md` lines 420–425 — the audit of dead anchors and the mutations recorded as caught.

  **The corollary used to be worse than the inconvenience, and was fixed on 2026-09-18.** A manifest
  nobody touched was never checked again, so its evidence rotted in silence: a full audit found
  **57 dead anchors across 34 of 93 manifests — 12% of all 468 mutation claims**, three manifests
  dead outright. (An earlier partial count said 45 across 29; the measured figure is 57.) Repairing
  them exposed **three mutations recorded `caught` that actually survived** — one live on `main` the
  whole time, invisible because a dead sibling made its manifest refuse to replay at all.

From `source/references/rationale.md` lines 427–431 — the anchor check, by its yarn alias.

  **`yarn mutate:anchors` now checks every anchor in every manifest** — a string count, no build, no
  tests, all 94 in under a second — and runs ahead of the replay in `verify-manifests.sh`, so a dead
  anchor costs one second instead of twenty minutes. Anchors no longer rot in silence. **The replay
  is still diff-scoped**, so the rest of this rule stands: touching a manifest still arms its full
  replay.

From `source/references/rationale.md` lines 433–444 — the test-selection check and the two patterns that matched nothing.

  **The same check now asks the second question, added 2026-09-18: does the `command`'s `-t` still
  select a test?** `vitest -t` is a REGEX, and a pattern that matches nothing skips every test and
  **exits 0**, which `mutate:verify` reads as `survived`. That is worse than a dead anchor — a dead
  anchor refuses, this one answers, confidently and wrongly. It did so twice: a title's `(X30)`
  pasted into the pattern, where the parentheses are a capture group and not two literal characters
  (182 tests skipped, exit 0, "survived"), and three `sg4` entries after SG10 renamed the test they
  name. The check proves a pattern live from the test file's syntax where it can (no spawn) and
  escalates the rest — a `test.each` title formatted per case, a title that is an expression — to
  `vitest list`, so it condemns nothing it has not seen vitest refuse. Cost on 2026-09-18: 212
  patterns, 207 proved by syntax, 5 listed, ~8s all in. **When you write a `-t`, verify it selects
  before you record it** (`yarn vitest list <file> -t '<pattern>'` prints the tests it picks, or
  nothing), and escape the metacharacters in a title you are copying.

## Originals of paragraphs the generic skill words without a date or an incident link

The generic skill drops an incident date, or repoints a link to a renamed heading. The original
paragraphs stay here, verbatim, so nothing is lost.

From `source/SKILL.md` — the why-link that targeted the heading before it was renamed.

(why: [rationale](references/rationale.md#four-defects-on-2026-09-16-came-from-briefs-that-failed-exactly-this))

From `source/references/rationale.md` — the paragraph that carried a discovery date.

A green local gate is not a green CI. Found 2026-09-08 by the hexagen-monaco orchestrator, which
hit the same class in its own repo: it ran the stated gate, passed, and reddened `main` on
`typecheck:test` — a step the stated gate never included. **Rule: when you write a gate into a
brief, diff it against the CI workflow first. Whatever CI runs and the gate does not, name in the
brief as what a green does not cover.**

From `source/references/rationale.md` — the remediation step that carried the date of the incident.

3. **Remediate.** Merge verified findings into a fix brief (Template C), listing refuted items with
   reasons. **After any interrupted or killed `mutate:verify`, scan for a stranded mutation before
   anything commits**: a mutation applies a change to the source and restores it at the end, so a
   run that dies in the middle leaves the source mutated and the next commit ships it. The check is
   five lines — for each manifest entry, assert its `before` text is present and its `after` text is
   not. It ran four times on 2026-09-16 (0 stranded each time) and is cheap enough to be
   unconditional; a killed verification is the one moment the working tree can be silently wrong.

From `source/SKILL.md` lines 109–113 — the two closing brief lines. The generic skill reworded this line ("every verification command") so a `targeted-only` lane is not told to run a gate it must not run; the original is kept verbatim so the pinned snapshot stays covered.

- *If a finding is wrong, say so with the mechanism rather than changing code to match it.* Counters
  the failure that rots a suite quietly — an assertion weakened until it passes.
- *Run the gate in the foreground and read its exit code. A task you launched is not a result.* Two
  seats reported green gates they had started and never watched; one of those branches did not
  typecheck.

## Originals of the two paragraphs OW4 rewrote to name the shipped briefs

The generic skill now says "Template A (in the shipped reference)" rather than "Template A (in the
pipeline runbook)", because the pipeline runbook is not something this skill can reach and the four
prompt templates ship with it. Those two paragraphs were the only place in the repository where the
pinned source wording survived — the overlay at house-rules.md keeps the runbook paragraphs, but not
these two — so without this section the coverage check would report them uncovered and, correctly,
there would be no tree left to restore them into.

From `source/SKILL.md` lines 238-240 — the lane-dispatch paragraph, whose "Template A" citation now
names `references/briefs.md`. Appended byte-for-byte, wrapping included.

   Write each brief from Template A, then dispatch it as an `Agent`. **Record the worktree tip
   first** — an agent that reports success having committed nothing looks identical to one that did
   the work. Never let two lanes own the same file at the same time.

From `source/SKILL.md` lines 282-284 — the Remediate stage, whose "Template C" citation now names
`references/briefs.md`. Appended byte-for-byte, and the first line is left unwrapped exactly as in
the source because anchors match trimmed whole lines: `3. **Remediate.** …` is a bold-lead anchor and
reflowing it would be a different anchor.

3. **Remediate.** Merge verified findings into a fix brief (Template C), listing refuted items
   with reasons. **After any interrupted or killed `mutate:verify`, scan for a stranded mutation
   before anything commits.** (why: [rationale](references/rationale.md#3-remediate))
