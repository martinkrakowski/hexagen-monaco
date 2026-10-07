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

## Wave 1 — the findings store, lanes G1 and G2 (2026-09-08)

Plan: `docs/planning/findings-store.md`. Orchestration: `.claude/skills/orchestrate-wave/`
(not checked in; copied into each lane worktree) over `docs/workflows/`. First wave run in this
repository, and the first that can be costed at all.

**Which spec governed what.** `.agents/ORCHESTRATOR.md` decided the lanes; `orchestrate-wave`
decided how each lane became a merged PR. See this file's header table — that split was the
resolution of the plan's §8 gap 1 and it held without friction.

### What merged

| PR   | Lane                                        | Squash     | Net                                            |
| ---- | ------------------------------------------- | ---------- | ---------------------------------------------- |
| #669 | orchestration housekeeping                  | `ab456ac7` | scripts + runbook tracked, session log created |
| #670 | G1 — make the existing record authoritative | `598b9a3a` | +349/−6, 7 files, 469 tests                    |
| #671 | G2 — finding schema, parser, validator      | `2de5a9fd` | +1359, 6 files, 548 tests (from 479)           |

### The plan was wrong about its own premise, and the correction was the wave's largest saving

F-D7 said a generated project records no add-on templates and proposed adding an `addons:` list
to `.architecture/manifest.yaml`. It already records them, in `.hexagen-template-config.json`,
with each template's own `version` — F-D6's join key, already implemented. The original search
was `find -maxdepth 2 -name "hexagen*"` plus a grep of `.architecture/`; the file is a dotfile at
the project root, so the first pattern could not match it and the second looked in the wrong
place. Building the proposed list would have created a **second source of truth for the same
fact** — the exact defect class this store exists to collect.

Rule now written down: **a claim that something does not exist must be tested against the tool
that would create it, not only against the filesystem.**

G1 was re-cut from "build a record" to "make the existing one authoritative", and the real gap
turned out to be narrower and sharper: `load()` returns `emptyConfig()` on ENOENT, so _absent_
and _present-but-empty_ were indistinguishable, and the store had no test file at all.

### What the review layer bought

Three independent layers — a model reviewer (`hy4-preview`, read-only, throwaway worktree),
Qodo, CodeRabbit. Thirteen findings fixed, eight refuted with mechanism. Three were invisible to
every gate, because all of them **passed**:

1. **The F-D4 body path check was a prefix match.** `file://`, `~/`, `../`, UNC, and any path
   after a character outside a short delimiter set were accepted verbatim. Whether client content
   was refused depended on the author happening to type a space first. F-D4 requires the record
   be _incapable_ of carrying client content; it was a rejection list wearing the costume of a
   guarantee. Found independently by all three reviewers.
2. **`id` was an unguarded free-text field.** Validated only for non-emptiness, so `id:
acme-corp-bug` passed straight through the closed vocabulary and the body check both — in a
   schema whose entire premise is that no field can carry a client name.
3. **A non-semver `currentVersion` silently disabled the version gate.** `validateManifest`
   accepts any non-empty string, so a manifest at `1.0` made `compareSemver` return `NaN`; every
   comparison against `NaN` is false, so "not ahead" passed. A gate that switches itself off is
   worse than no gate, because the record keeps claiming the guarantee.

Two fixes composed into a property neither had alone: length-then-lexicographic version ordering
is exact **only because** the leading-zero ban landed first.

**And the review layer's single most confident finding was wrong.** Both `hy4-preview` and Qodo
independently said `loadState?` should be required, arguing no gate would catch it, citing
AUD-020's note that `typecheck:test` "is run by no workflow". AUD-020 is the problem statement
that CI step was _added to fix_: `sync-integrity.yml:95` runs it, and `tsconfig.test.json`
includes `__tests__/**`, so a required method would have failed `stubConfigStore` — a file
outside the lane's ownership. Acting on it would have turned a green PR red. Verifying every
finding before acting is what stopped it, and it is the reason two reviewers agreeing is not
proof.

### Defects in the orchestration, all mine

1. **`nohup … & disown` from a returning tool call does not survive here.** Both lanes' first
   dispatch died before writing a byte or an `EXIT` marker. Two zero-byte logs at five minutes
   look exactly like cast.md's silent-start hang; had the kill-and-reseat rule been applied, a
   healthy lane would have been moved to a different seat and the failure would have repeated.
   The process table said otherwise: **a 0-byte log with no child process is a launch failure; a
   0-byte log with a live child burning CPU is a model hang.** Only the second is the rule.
2. **The first review was blocked by a permission ask I created.** The reviewer had a throwaway
   worktree but every git command in its brief pointed at the main checkout — an
   external-directory ask that cannot be answered without a TTY. It exited `EXIT 0` after ten
   successful reads, looking like a model that gave up. The tool-call status list (one `error`
   among ten `completed`) is what said otherwise. The brief also demanded a mutation while
   denying write access: a required output behind a fence around the thing that produces it.
3. **The gate in the brief was incomplete, and it is a plan defect.** §1 F5 says
   `build && typecheck && lint && test`. `typecheck` excludes `__tests__` by design, so CI's
   `typecheck:test` (`sync-integrity.yml:95`) is a gate no lane was told to run — which is how G2
   passed the stated gate and reddened CI. **F5 must be corrected before wave 2**, since every
   brief quotes it. CI's sync-integrity job also runs `yarn constraints`, hardened `sync` with
   post-sync verification, and generator parity.
4. **The round-1 fix brief for G2 was built from one reviewer without pulling the bots.** Rule 1
   is one brief carrying _every_ verified finding. Round 1 was not refuted; it was incomplete
   because I under-gathered, and round 2 cost ~251k billed and 6.3M cache that should not have
   been separate.
5. Minor: the brief said "eight flat scalar keys" where the plan defines nine. The lane caught it
   and said so under Deviations rather than silently following or silently correcting.

Every failure this wave was in the scaffolding or the briefs. The three seats did what they were
asked whenever the asking was coherent, and twice corrected the orchestrator with evidence.

### Cost — runs per seat, and what a lane actually costs

| run          | seat                        | steps   | billed        | cache read     |
| ------------ | --------------------------- | ------- | ------------- | -------------- |
| G1 implement | `opencode-go/glm-5.3-flash` | 61      | 149,749       | 3,897,920      |
| G1 review    | `opencode-go/hy4-preview`   | 50      | 108,759       | 1,681,024      |
| G1 fix r1    | `opencode-go/glm-5.3-flash` | 40      | 62,604        | 1,584,896      |
| G2 implement | `opencode/big-pickle`       | 86      | 298,994       | 8,414,976      |
| G2 review    | `opencode-go/hy4-preview`   | 19      | 86,812        | 576,576        |
| G2 fix r1    | `opencode/big-pickle`       | 89      | 290,171       | 8,719,872      |
| G2 fix r2    | `opencode/big-pickle`       | 79      | 250,951       | 6,268,672      |
| **total**    | 3 seats, 7 runs             | **424** | **1,248,040** | **31,143,936** |

Runs per seat: glm-5.3-flash ×2, big-pickle ×3, hy4-preview ×2 (plus one blocked review that
produced nothing). `gemini` unused — its track record says catastrophic on open lanes, and the
measured boot floor makes it >2× opencode's cost for a narrow one. `grok` probes as
unauthenticated; quota resets 2026-09-14.

**Cache read is ~25× billed.** This independently reproduces the reference project's measurement
(3,997,888 cache read at 50 steps, 114,486 peak context) on a different repo, task and lane — G1
came in at 3,897,920 and 104,129. That makes it a structural property of a lane, not of one
task: cost is roughly _context × steps_, so an extra round is expensive because it accumulates a
fresh transcript, not because of the ~15k boot. G2 cost twice G1 for 3.5× the lines while taking
41% more steps — cache traffic rose 116%, which is the superlinearity in one wave.

Practical consequence, already applied to both briefs: put the gate and any long log **last**, so
its output is re-read by as few subsequent steps as possible; quote what an agent needs rather
than pointing it at a file (both briefs' read lists were narrowed from ~75 KB to ~15 KB); and
prefer one well-specified brief to an exchange.

### Deferred

- **Correct §1 F5's gate** — blocking for wave 2, since every brief quotes it.
- **Tighten `TemplateConfigStorePort.loadState` to required** — needs a lane owning
  `__tests__/application/validate-templates-ports.test.ts`.
- **`id` ↔ filename `NNNN-` agreement** — belongs to the guard, lands with G3's real files.
- **§8 gap 2**: `tools/wave-status/` unported, so `wave-event.sh`'s "byte-identical to `emit.ts`"
  claim stays untestable here.
- Next wave is **G3** (seed the store), which depends on G2's validator.

## Wave 2 — the findings store, lane G3 (2026-09-08)

Plan: `docs/planning/findings-store.md` (now tracked — wave 1 ran against it untracked).
Single lane, because the plan's order is `G1 → G2 → G3` and G3 depends on G2's validator.

### What merged

| PR   | Lane                                        | Squash     | Net                                         |
| ---- | ------------------------------------------- | ---------- | ------------------------------------------- |
| #673 | plan tracked + F5's gate corrected          | `123cb820` | the wave-1 blocker, cleared before dispatch |
| #674 | G3 — seed the store, prove the layout ships | `8d215446` | +307/−21, 5 files, 556 tests                |

`template-engine` is now 59 test files / 556 tests, from 54 / 479 at the start of wave 1.

### The finding class this wave surfaced: tests that pass without their premises

Nothing in G3 was broken. CI was green 9/9 and the gate passed 61/61 before review ran. What two
independent reviewers found instead was a category a green build is **structurally blind to**:

1. **The F-D3 isolation suite passed with every finding file deleted.** It built its "before" tree
   by filtering `findings/` out and asserted the before-tree lacked them — but never asserted the
   _with_-tree had any. Reproduced by moving both `findings/` directories out of `templates/`:
   `Test Files 1 passed`. The guarantee that no generated project ever receives a finding rested
   on a premise the test did not check.
2. **The "layout ships for free" test passed identically on `main` before anything was seeded.**
   It asserted only that two template ids resolve, never that the `findings/` directories exist.
   The actual proof of F-D1 at that moment was a stray the orchestrator planted by hand
   (`templates/ZZZ-not-a-template.txt` → guard red, `discoverTemplateIds` throwing at
   `build-template-bundle.ts:145`) — real, but living in a terminal rather than the suite.

Both now fail loudly when the condition in their name is false, and the isolation proof widened to
both seeded templates × both `--with-tests` paths. **A test whose name states a condition it does
not establish is worse than no test**, because it converts an unproven claim into a green check.

### What the review layer bought, and what verifying it bought

Nine findings fixed in one round, four refuted with mechanism, from a model reviewer (49 tool
calls) and Qodo. CodeRabbit was rate-limited to a summary.

Two refutations mattered:

- **Qodo: "the arch-linter record is wrong about the linter."** Partly. `contextRootAbs`
  (`tools/arch-linter/src/cli.ts:585`) uses `layout.contexts[name].root` when mapped and falls
  back to `packages/<module>` otherwise; `.architecture/layout.yaml` has **no `contexts:` block**,
  so nothing under `apps/` is opened today. The record's conclusion was right; its prose implied a
  hard-coded glob, which is what drew the dispute. Sharpened rather than corrected. **The store's
  credibility rests on findings being exact about mechanism** — a vague finding gets argued with
  instead of fixed, and this is the first component record, so it sets the pattern.
- **Qodo: the Windows path bug.** Real in the code, but it could not fail CI: the Windows job runs
  `turbo run test --filter=@hexagen/sync --filter=@hexagen/arch-linter`, so `template-engine` tests
  never execute there. Fixed anyway — the filter is one edit from including this package.

### A fifth orchestration failure mode, and the first that was not the orchestrator's

The fix round was **killed by the host system for low memory**, after the lane had finished editing
and committing but before it pushed: five commits, clean tree, no `EXIT` marker.

The honest reading of "killed, no marker" is a dead lane, and re-dispatching would have cost
roughly a quarter-million tokens to redo work that already existed on disk. Deriving the state —
commits, tree, and re-running the lane's own reproduction — showed the work was complete. The
orchestrator verified it (gate `exit 0`, 61/61, 556 tests, scope unchanged, `src/` and
`tsup.config.ts` untouched), reproduced the finding-1 red-then-green demonstration independently,
and pushed the lane's commits **unmodified**. No orchestrator-authored code is on that branch.

**The derived-state rule is symmetric and only one side had been tested.** Every earlier
application caught something that looked fine and was not; this one caught something that looked
failed and was not.

### Cost — and evidence the wave-1 cost rules worked

| run          | seat                        | steps   | billed      | cache read    |
| ------------ | --------------------------- | ------- | ----------- | ------------- |
| G3 implement | `opencode-go/glm-5.3-flash` | 48      | 352,097     | 2,343,168     |
| G3 review    | `opencode-go/hy4-preview`   | 38      | 104,659     | 1,479,040     |
| G3 fix r1    | `opencode-go/glm-5.3-flash` | 44      | 182,143     | 2,783,040     |
| **total**    | 2 seats, 3 runs             | **130** | **638,899** | **6,605,248** |

Runs per seat: glm-5.3-flash ×2, hy4-preview ×1. gemini and grok unused.

**Cache-to-billed ratio fell from ~25× in wave 1 to ~10× here** (31.1M/1.25M → 6.6M/0.64M), and
mean steps per run fell from 61 to 43. The rules applied between waves were: narrow the brief's
read list (AGENTS.md + TESTING.md only, ~15 KB instead of ~75 KB), run the gate **once as the last
action**, quote decisions into the brief instead of pointing at a document, and supply the facts a
lane would otherwise go looking for — the three subject versions, the closed class vocabulary, the
exact line references. Cost is roughly _context × steps_, so those compound.

One fix round instead of wave 1's two, because every review source was gathered **before** the
brief was written rather than after — the wave-1 defect that cost ~251k tokens.

### Deferred

- **G4** (query API) is unblocked. Inherits G2's module-not-package constraint.
- **G5**'s §4 DoD says "run inside the reference project", which is not verifiable from this repository.
  **Amend it before G5 dispatches**, the way F5 was amended.
- **G6 / G7** — the plan says re-plan once G5 has been used; they should not be dispatched against
  the current text.
- `loadState` → required, still needs a lane owning `validate-templates-ports.test.ts`.
- §8 gap 2: `tools/wave-status/` unported, so `wave-event.sh`'s parity claim stays untestable here.

## Wave 3 — the findings store, lane G4 (2026-09-08/09, merged 2026-09-17)

Plan: `docs/planning/findings-store.md`. Single lane: the read path.

### What merged

| PR   | Lane                                                    | Squash     |
| ---- | ------------------------------------------------------- | ---------- |
| #676 | G4's ownership, layer split, and the packaging question | `5fc27a50` |
| #677 | **G4** — the findings query API and file-system reader  | `732e9591` |

`template-engine`: **61 test files / 592 tests**, from 54 / 479 at the start of wave 1.

### The plan was wrong about G4, and it was caught before a lane paid for it

Two stale premises in one table row. Ownership named `packages/template-findings` — the package
decided against for G2 (a new workspace needs a `yarn.lock` entry; every CI job installs
`--immutable`). And it said to reuse `resolveTemplatesDir()`, which lives in `packages/sync`,
resolves relative to **its own** module, and sits on the wrong side of the dependency arrow:
`sync` depends on `template-engine`, never the reverse.

The correction moved resolution to the caller that already owns it. `listFindings` takes the
templates directory as an argument, so one function serves both layouts because the caller
supplies the difference. That also turned "no network call is possible" into a **checkable
statement about imports** rather than a claim about path logic.

**Then the same method caught a defect in the correction itself**: it put an fs-walking function in
`src/domain/`, where nothing imports `node:fs` by design. Reader moved to `infrastructure/`, pure
filtering kept in `domain/`. Four defects of this shape across the arc — F-D7's premise, F5's
gate, G4's ownership, and the orchestrator's own layer assignment. The method does not care
whose text it is.

### The finding class went one layer deeper than wave 2

Wave 2 found tests that pass without their premises. Wave 3 found **contracts the happy path
never exercises**. All seven review findings were in failure paths reachable only by constructing
the bad case:

1. **The walk could read outside the directory it was given.** Symlinked directories _under_
   `findings/` were skipped as documented, but `findings/` itself was dereferenced — so a
   symlinked `findings/` escaped the argument. "Reads only beneath it" is the property that makes
   `listFindings` safe to point at an installed `node_modules` tree, which is its entire purpose.
   Found independently by both reviewers.
2. **A manifest declaring another id corrupted the join key.** `versions` was keyed on the
   directory name with its value taken from the manifest, unchecked — so `alpha/` holding a
   manifest for `beta@9.9.9` joined alpha's findings against beta's version. **This is the second
   join-key defect of the arc**: G2 shipped a semver comparator accepting leading zeros, so
   `01.2.0` validated and then matched no manifest version that would ever exist. Both invisible
   to every gate; both would have produced findings that quietly describe the wrong thing, which
   for a findings store is worse than producing none.
3. **The no-network assertion scanned a directory, not the import graph** — missing a _value_
   import in that graph, while its name claimed otherwise. Its fix was proven the right way:
   injecting `node:dns` and `undici`, confirming both slip past the old pattern set and are caught
   by the new one.

Plus: `.md` matched case-sensitively so a `.MD` finding vanished silently; read-path faults
escaped as raw FS errors against the module's own typed contract; and the reader accepted a
finding whose filename did not match its id — the guard enforces that on the **committed** store,
but the reader's subject is an **installed tree nothing has guarded**, so an invariant maintained
at commit time may not be assumed at read time.

### A lane interrupted mid-run, and why it was continued rather than re-run

The implement run died on a **malformed tool call** after building everything and completing three
of four mutations, but **before committing**: six files in the worktree, no `EXIT` marker.

That looks identical to wave 2's OOM kill from the marker alone, and the two needed opposite
responses. Wave 2's lane had _committed_, so pushing it was mechanical. This one had not — **and
its uncommitted work carried `TS2322` in its own test file**, green under `vitest` and red under
`typecheck:test`. Packaging it as recovery would have pushed a red CI while three merged records
insist CI is the real gate.

**The gate is what distinguished them.** F5's correction, added two waves earlier after G2 passed
the stated gate and reddened CI, caught its second defect here — one step before the orchestrator
would have repeated the mistake it was written to prevent.

The response was a **narrow continuation brief** rather than a re-run: it carried everything
already verified (files intact, no mutation left applied, 25 tests green, the layer split
confirmed, and **mutation 4 run by the orchestrator** — it kills 2 tests, so the fail-loudly
decision is pinned), leaving one real task. Re-running the lane would have redone the design work
to fix one line.

### Cost — and a gap in the measurement discipline

**The raw logs for this wave are gone.** They lived in a session scratchpad under `/private/tmp`,
which was cleaned on 2026-09-14 before the wave record was written. What survives is what the
orchestrator read at the time:

| run                    | steps                                     | billed                         |
| ---------------------- | ----------------------------------------- | ------------------------------ |
| G4 implement (cut off) | 50                                        | 279,570                        |
| G4 review              | 17                                        | 93,060                         |
| G4 fix round           | 90                                        | 523,113 (cache read 8,986,752) |
| G4 continuation        | _not extracted before the logs were lost_ | —                              |

**The lesson is the rule, not the numbers**: cast.md rule 7 says a dispatch that cannot be costed
is a dispatch that ignored the rule, and that there is no retroactive accounting. That applies to
the _orchestrator_ too. A wave's cost must be written into its record — or at least into
`events.jsonl` in a durable location — **when it is observed**, not reconstructed at close-out.
Waves 1 and 2 recorded theirs in time; this one did not, because the wave stayed open across an
eight-day gap. **Close a wave's record when its lanes settle, not when its PRs merge.**

### Deferred

- **G5 is blocked.** Its §4 DoD says "run inside the reference project", which is not verifiable from
  this repository. Amend it the way F5 was amended, before dispatch.
- **G6 / G7** — the plan says re-plan once G5 has been used; do not dispatch against current text.
- `loadState` → required, still needs a lane owning `validate-templates-ports.test.ts`.
- §8 gap 2: `tools/wave-status/` unported, so `wave-event.sh`'s parity claim stays untestable.
- **Put `events.jsonl` somewhere durable.** A session scratchpad under `/private/tmp` is cleaned
  on a timer, which silently destroys the wave-status record this orchestration is built to emit.

## Wave 4 — the orchestration template, `orchestration-template-w01` (2026-09-29/30)

Plan: `docs/planning/2026-09-29_orchestration-template.md`, r8 (§12 amendments through A-32).
Lanes OW1–OW9, with OW3 cut into OW3a–OW3f (A-28, A-31, A-30). Events:
`$HOME/.waves-hexagen/wave-orchestration-template-w01/events.jsonl`.

### What merged, with the squash commits

| Lane                                | PR   | Squash     |
| ----------------------------------- | ---- | ---------- |
| OW1 — scrubbed fixture and coverage | #688 | `17f18026` |
| OW3a — package scaffold and config  | #689 | `2419cba9` |
| plan r5 amendments                  | #691 | `a754b4c1` |
| OW3e — mutate family                | #692 | `d8e30320` |
| OW3b — plan-review, sweep, merge    | #693 | `0e4f2127` |
| OW3d — gate, gate-lock              | #694 | `683a4d69` |
| OW3c — wave-status                  | #695 | `fd1d8b92` |
| plan r7 (A-30, A-31)                | #696 | `8ebbef09` |
| OW4 — the template                  | #698 | `ede1b5ca` |
| OW5 — wave-status checkpoint        | #699 | `2d4ee10c` |
| OW3f — lane hosts and seats (A-30)  | #700 | `1208e982` |
| A-32 — configurable `ciWorkflow`    | #701 | `7b5526ab` |
| OW6 — hexagen dogfoods the template | #702 | `916c5feb` |
| OW9 — CPM proposal                  | #703 | `2619f70c` |
| de-flake the Ctrl-C group-kill test | #704 | `6900e24b` |
| OW7 — capstone and packaging        | #705 | `cbf0b97d` |
| OW8 — hexagen-side round trip       | #706 | `e336ecc9` |

`main` was green after every merge. Where CI failed, the failure was the known `apps/web`
`AIGenerationPage.workbench` flake, and a re-run passed.

### Defects found in the _plan_, not the code

- **A-30.** The schema had no place for a remote lane host or a seat's dispatch identity, and
  `opencodeServerUrl` modelled only a local HTTP server. The fix added `laneHosts` and `seats`.
  It also added the rule that a host's `check` must exercise the dispatch path itself: an
  `ssh … curl /doc` probe goes green while the dispatch fails.
- **A-32.** `doctor` hard-coded `.github/workflows/ci.yml` as the one required workflow, so
  dogfooding in this repository failed on a workflow it has (`sync-integrity.yml`). The fix
  made `ciWorkflow` configurable. The owner chose this over accepting the FAIL.
- **Scaffold defaults that are wrong for this repository.**
  - `requiredCheck: ^Build` matches no check here. OW6 sets `^Verify Sync Engine`, and a
    dogfood test proves that pattern names a real job in the configured workflow.
  - The scaffolded house rules say "every lane appends" events. The skill assigns emission
    to the orchestrator, and a remote lane's `$HOME` is not the log the status page reads.
    Fixed in hexagen's overlay; still open in `init`.

### What the review layer bought

Fable 5.1 held the reviewer seat from OW3f on, after grok-4.7's balance ran out (HTTP 402).
Every lane was reviewed before its first push, and fix rounds went to a separate implementer
seat. The findings that mattered:

- **OW3f: shell injection over ssh.** `runRemote` passed its remote words unquoted. ssh joins
  them and hands the string to the remote login shell, so a `clone:` of `/srv/repo; …` would
  have executed on the lane host. The fix quotes every word, proven against a real `sh`.
- **OW3f: the group-kill test timing out under suite load.** It failed 3 out of 3 runs inside
  the full package suite.
- **OW6: wrong or private content bound for a public file.**
  - The house rules named the wrong wave-log directory.
  - The gate lacked `typecheck:test`.
  - A key-file paragraph in the relocated seat record was trimmed to a generic rule, on the
    owner's decision. The branch was squashed before its first push, so the original text
    never reached the remote.
- **OW9: copied spec text.** The proposal copied two complete enumerations out of the
  unpublished CPM spec while saying nothing was reproduced. The copy was amended out before
  the first push.
- **OW7: red cases that passed for the wrong reason.**
  - The failing gate step was an unquoted `node -e process.exit(3)`, a shell syntax error,
    so it exited 1, not 3.
  - The init idempotence check could not tell skip-if-exists from a deterministic
    overwrite.

  Review also added a symlink-escape refusal to the publish script.

- **The capstone itself found a release bug.** `prepare-publish-package.js` staged only
  `dist/`, so the published orchestration package would have had no `bin/` or `public/`. As
  published, its gate could not run. The script now stages the `files` array. The `sync` and
  `arch-linter` tarballs were proven unchanged.
- **CI found what local runs did not.** Two defects passed on the orchestrator's host and
  failed on the runner:
  - OW8's script statically imported workspace sources before building them, which only
    worked because a local `dist/` already existed.
  - The Ctrl-C test's liveness probe counted a zombie as alive.

  The OW8 fix was reproduced cold, red then green, in a scratch worktree with nothing built.

### What was refuted, and why

- **qodo, "add the control-byte scan to hexagen's gate."** The gate is a subset of CI with
  the difference named, and CI runs no byte scan. The real mismatch is one level up, between
  the scaffold defaults and the skill's sentence, and is recorded as a follow-up.
- **qodo and CodeRabbit, "add `--output-format json` to the `agy` commands."** `cast.md` is
  the owner's graded record, relocated rather than rewritten (F-10). The flag cannot be
  verified from this repository.
- **CodeRabbit, "fail the Darwin diagnostic on empty discovery."** The mirror must match the
  template byte for byte, so the change belongs to the template.
- **qodo, "Turbo may pack a stale build."** The cache key hashes the package's inputs, so a
  hit restores exactly the current build.

### Runs per seat

This is the gap Wave 3 warned about, repeated: costs were not written down when they were
observed. What survives:

| seat                                        | runs                                                                                                             | measured                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `space-bunny` via `midnight` (`ocm-run`)    | OW3f, OW4                                                                                                        | OW3f: 3,375 s, 778,254 in / 88,187 out, 16.4 M cache read. OW4: 3,469 s, 263,846 in / 73,301 out, 26.9 M cache read. Both from `lane-usage`. |
| Sonnet subagents on the orchestrator's host | about 21 dispatches and 5 resumptions (lanes that had to read outside a sandboxed worktree, and every fix round) | per-run token totals were visible at the time but not recorded                                                                               |
| Fable 5.1 (reviewer)                        | about 14 pre-PR reviews and re-reviews                                                                           | not recorded                                                                                                                                 |

Earlier lanes' opencode sessions (OW1, OW3a–OW3e) are not in the midnight database. They ran
before the lane-host move and cannot be costed now. **The rule stands, and this time applies
to the orchestrator too: write each run's cost into `events.jsonl` when it finishes.**

### Deferred

- **Owner actions:**
  - Publish `@hexagen-monaco/orchestration@0.1.0`. Release tags are owner-gated.
  - Swap the untracked `.claude/skills/orchestrate-wave/` for the symlink after pulling main.
    A verified copy is in the wave directory.
  - Paste the Wave Observability section into `AGENTS.md`.
- **The `merge-prs` red (§7, manual).** It needs a throwaway PR with a failing required
  check, so it has not been run yet.
- **Branch protection.** `main` has no required status checks, so every red check here is
  advisory to the merge button.
- **Package follow-ups:**
  - `init`'s house rules should state who emits events and the status server's read-only and
    loopback guarantee, and should read the default port from its constant.
  - The scaffold defaults disagree with the skill on the byte scan.
  - The template's Darwin diagnostic should fail on empty discovery.
  - `lane-usage` should become a package bin.
  - There is a `gate-lock` release TOCTOU, a candidate to fix upstream in the reference project.
- **The `apps/web` `AIGenerationPage.workbench` flake.** It failed CI four times on
  unrelated commits on 2026-09-30.

- Records in this log were edited on 2026-10-01 to remove references to another project, at the owner's instruction.

## Wave 5 — orchestration parity, `orchestration-parity-w02` (2026-10-01)

Plan: `docs/planning/2026-10-01_orchestration-parity-plan.md`, with owner decisions P-D1 to P-D7.
Lanes PB1 to PB8. Events: `$HOME/.waves-hexagen/wave-orchestration-parity-w02/events.jsonl`.

### What merged, with the squash commits

| Lane                                         | PR   | Squash     |
| -------------------------------------------- | ---- | ---------- |
| plan                                         | #709 | `27033c3a` |
| PB1 — sweep `--post`, brief line, 0.1.1      | #710 | `c659ffe9` |
| PB4 — `fix-brief`                            | #712 | `036966ee` |
| de-flake the Ctrl-C group-kill handlers      | #713 | `0bd23834` |
| PB8 — plan-review lane/decision markers      | #714 | `1e35ff11` |
| PB2 — gate-lock slots, one gate per worktree | #715 | `294ac746` |
| reference scrub of tracked files             | #716 | `139a39ad` |
| 0.2.0 bump (published, 0.1.0 deprecated)     | #717 | `1c1a1f87` |
| PB6 — `brief-new`                            | #718 | `fe77c28e` |
| PB3 — `gate-run.sh` signal hygiene           | #720 | `b93f04f6` |
| PB5 — `lane-watch`                           | #719 | `d9989e33` |
| PB7 — process rules, `installProbes`         | #725 | `6c6a07fa` |

`main` stayed green. Every red CI run was the `apps/web` `AIGenerationPage.workbench` flake, now
filed as #723, and each passed on re-run.

### What the review layer bought

Fable 5.1 reviewed every lane before its first push. Normal-risk lanes got one combined pass;
high-risk lanes got their own. The review bots ran on every PR. The findings that mattered:

- **PB3: a step could hold the caller's pipe.** Saving fds 3 and 4 for cleanup leaked them into
  every step, so a background child left by a step kept the gate's caller from seeing EOF. Each
  step now runs as `( exec 3>&- 4>&-; eval … )`. The plan row's "never on the eval" wording was
  what left this open.
- **PB3: a pause hook that pinned the wrong ordering.** One flag-placement mutant survived until
  the hook moved between the heartbeat `kill` and its `wait`.
- **PB6: a remote `full` host dropped the lane-host variant.** That would have let a remote lane
  push. Fixed before the first push.
- **PB5: a dotted session id passed the allowlist.** `/session/..` normalised to `GET /`. Ctrl-C
  was also swallowed during `usage`.
- **PB5 (bots):**
  - the final SSE frame skipped the size cap;
  - a whole chunk was buffered before yielding;
  - a mismatched session record was accepted;
  - doctor missed lane-watch behind a launcher (`npx`, `env`).
- **PB7: two shipped rule texts contradicted practice.**
  - "Verified before its PR opens" cannot hold for a local host, whose CI only runs on a PR.
  - "Before dispatch" excluded the combined post-implementation pass that is actually run.
- **PB7 (bots):**
  - remote probes ran in the remote home directory, not the worktree;
  - unknown probe keys were ignored;
  - the README's example repair could not repair;
  - doctor failed forever on another platform's probe, now fixed with a `platform` field.

### What was refuted, and why

- **qodo, "process-rule tests read the real disk."** They exist to pin the shipped skill text, so
  reading the shipped files is the point. The mirror and coverage tests follow the same pattern.
- **qodo, "a signal between `RELEASE_STARTED=1` and the fork skips the release."** POSIX sh
  cannot mask signals, so the window is inherent. It is documented, and the next acquire
  self-heals the lock.

### Verified outside CI

- **`lane-watch usage` works against the midnight opencode server.** `GET /session/<id>`
  carries numeric `time`, `tokens` (input, output, reasoning, cache read and write) and `cost`.
  The built bin exited 0 through a short tunnel.

### Runs per seat

| seat                                        | runs                                                       | measured     |
| ------------------------------------------- | ---------------------------------------------------------- | ------------ |
| Sonnet subagents on the orchestrator's host | PB3, PB5, PB6 and PB7, with 2 to 4 resumed fix rounds each | not recorded |
| Fable 5.1 (reviewer)                        | 4 pre-PR reviews                                           | not recorded |

Costs were again not written into `events.jsonl` as the runs finished. This is the third wave
in a row with that gap.

### Deferred

- **Switch host `m`'s usage reader to lane-watch.** Add `server:` and change `usage:`.
- **`gate-run.sh`: a second INT or TERM during cleanup resets to the default handler.** For
  parity with gate-lock, ignore both during release.
- **The P-D2 owner question: who keeps the loopback tunnel open during `lane-watch follow`.**
  The skill states "the caller" as the working assumption.
- **A `follow` started after the lane went idle reports a stall.** No allowed endpoint gives
  the session's current status.
- **#723: the `AIGenerationPage.workbench` flake.**

---

## Wave 6 — brownfield carry-forward, first lanes in the project's own lane container (2026-10-07)

Out of order on purpose: the records for the brownfield workbook wave (`brownfield-workbook-w03`,
#722–#743) and the kit wave (`kit-plans-w05`, #745–#765) are still missing. This record does not
replace them.

### What merged

| PR   | Squash     | What                                                                          | Made by                                            |
| ---- | ---------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| #769 | `5dee2cad` | Scaling test for `parseStructuredConfig` measures inputs large enough to time | orchestrator                                       |
| #768 | `28679be2` | `cleanText` strips bidirectional controls and zero-width characters           | orchestrator                                       |
| #770 | `3c85256a` | Missing exports in two `@generated` mcp-server barrels                        | lane (edits), orchestrator (commit)                |
| #771 | `89f3127c` | Brownfield viewer reads a bundle in a Web Worker; reads can be aborted        | lane (first commit), orchestrator (two fix rounds) |

#769 came first because `main` had been red since 2026-10-05 on that one test, and every pull
request inherited the failure. The old test divided a 189 ms parse by a 0.44 ms one on a shared
runner and compared the ratio with 256.

### What changed in how a lane is run

- **Lanes now run in the project's own lane container**, not on the shared server. A lane sees
  only this repository's clone and its own worktrees folder, and reaches the model through a
  host-side key proxy. The container holds no provider key.
- **Verification moved off the orchestrator's laptop** to a separate verification host that holds
  no credentials and never pushes. One script runs install, build, `typecheck`, `typecheck:test`,
  lint, a format check of the changed files and the tests, for the packages named.
- **The brief lives at `.lane/brief.md`** in the worktree. `.agents/briefs/` is not ignored in
  this repository, and a brief outside an ignored path would be committed by the lane.
- **The orchestrator runs the install and a dependency pre-build before dispatch.** A lane that
  installs for itself spends steps and reports failures badly.
- **A lane commits by itself with a plain `git commit`.** No hook is installed in the lane
  host's clone (Yarn 4 does not run the `prepare` script on install, so husky is never activated
  there). See "Defects found in the plan" for how this was first got wrong.

### What the review layer bought

- **#771, the orchestrator's own read of the lane's diff:** when the worker failed and the
  main-thread fallback then rejected, the promise never settled. The page would have stayed on
  "Reading" with no error. Fixed with three tests; with the fix reverted two of them time out.
- **#771, bots (qodo, PR-Agent):** a second file choice left the first worker running to the
  end, holding its copy of the bytes; a failed worker kept running beside the fallback read.
  Both accepted. The read now takes an `AbortSignal`.
- **#768 and #770:** no bot findings.

No model review pass was spent on any of the four.

### What was refuted, and why

- **PR-Agent on #771, "add a 5 s timeout to the worker."** A 256 MiB bundle on a slow machine
  legitimately takes longer, so a fixed limit refuses valid input. A worker that never answers
  is the same hang the main-thread read had before.

### Defects found in the plan, not the code

- **The first brief told the lane to commit with `--no-verify`.** The lane agent's rules deny
  that flag, so the lane stopped with its files edited and the orchestrator committed for it
  (#770). The brief assumed the pre-commit hook would run on the lane host. It does not: a
  commit there takes 0.2 s and runs nothing. A lane-host branch for `.husky/pre-commit` was
  written, tested by a real commit in the container, found to be unnecessary, and dropped.
- **The verification script ran `typecheck` and `typecheck:test` in one turbo invocation.**
  `@hexagen/sync`'s own build was rewritten while its test sources, which import the package by
  name, were typechecked: a false "cannot find module". CI runs them as two steps; so does the
  script now.
- **A lane edited `src` and ran the package's tests without rebuilding.** The mcp-server
  end-to-end test asserts that `dist` is not older than `src` and failed inside the container.
  It passes wherever the package is built first.

### Verified outside CI

- **The worker is in the production build** (#771): the brownfield page chunk constructs
  `new Worker(new URL(<chunk>))`, and that chunk holds the worker's message handler.
- **Two lane containers on one bridge cannot reach each other**, probed from each side: ping
  gets no reply and TCP connections time out.
- **The lane host crashed and rebooted itself during this wave** (a kernel fault in a graphics
  driver, not caused by a lane). For the first minutes of that boot the storage pool was up with
  one of its three disks missing, and this repository's clone read as "not a git repository".
  Nothing was written during the gap. The orchestrator now checks that all three disks are
  mounted before any command that writes to the pool.

### Runs per seat

| seat                              | runs                                                | measured     |
| --------------------------------- | --------------------------------------------------- | ------------ |
| Poolside Laguna S 2.1 (`lane`)    | 2 lanes (18 and 42 steps), plus one read-only smoke | not recorded |
| Fable (one script review, 1 pass) | the container build scripts, outside this repo      | not recorded |

Costs were not written into an events file: these lanes were not run through the wave tooling,
which has not yet been pointed at the container's port. That makes four waves without them.

### Deferred

- **Records for the workbook wave and the kit wave.**
- **Run the wave tooling (events, the status push) against the container.**
- **`sync --check` in CI.** #770 fixed two drifted `@generated` files by hand; nothing stops the
  next drift.
- **A structured `kind` on `grant_denied`** in the trace, and **the denial counts that disagree**
  between the evidence pack and the viewer's left rail. Both need an owner decision first.
- **A shared schema for `verdicts.json`.**
- **The viewer's fallback is silent** (#771): a broken worker would put every user back on the
  blocking read with nothing reporting it.
- **`cleanText` strips where it could mark** (#768): a reviewer cannot see that a file held a
  bidirectional override.
- **The pre-commit hook fails on a developer machine** that has a `packages/sync/publish/`
  folder: the package's generated lint config does not ignore it.
- **The arch-linter tarball ships a `tsbuildinfo` file.**
