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

**Cache read is ~25× billed.** This independently reproduces the campaign-foundry L2a measurement
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
