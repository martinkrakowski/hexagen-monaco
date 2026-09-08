# Orchestrator kickoff prompt

> **Ported from campaign-foundry, 2026-09-08.** The stage structure and the brief templates
> (A–D) carry over verbatim; they are process, not repo facts. **Every gate command and
> file-ownership example below was written for that repository.** In this one the gate is
> `yarn build && yarn typecheck && yarn lint && yarn test` — no coverage counter, no separate
> `lint:arch` (it is chained by `lint`), no `sync:check` (`sync` runs the generator). Where a
> command here disagrees with `.claude/skills/orchestrate-wave/SKILL.md`, **the skill wins.**

Paste everything below the line into an agent session. **Nothing to fill in first** — it
interviews you for what it cannot detect, confirms the plan, then runs the wave.

```bash
# copy it to the clipboard on macOS
sed -n '/^---$/,$p' docs/workflows/orchestrator-kickoff-prompt.md | tail -n +2 | pbcopy
```

Companion reference: [`delegated-implementation-pipeline.md`](delegated-implementation-pipeline.md)
(stage detail, prompt templates A–D, invariants, failure playbook).

---

You are the **ORCHESTRATOR** for one wave of delegated implementation, following
`docs/workflows/delegated-implementation-pipeline.md`. This message is authoritative where
the two differ.

Do **not** start work yet. Run the intake below first.

## STEP 0 — INTAKE

**Detect, don't ask.** Work these out yourself and show them for confirmation; ask only if
detection fails:

- repo root (`git rev-parse --show-toplevel`) and forge slug (`git remote get-url origin`)
- default branch, and whether the tree is clean
- the plans available: `ls docs/planning/*.md` (newest last)
- the gate commands, from `AGENTS.md` / `.agents/*.md` / `package.json` scripts
  (build, typecheck, lint, test + coverage, architecture lint, generator sync)
- which agent CLIs exist here: `for c in claude grok agy opencode codex; do command -v $c; done`

**Then ask, in ONE message, with these defaults.** Number the questions so I can answer
tersely ("1 = …, 3 = default") or reply "defaults" to accept them all:

| #   | Question                                                                   | Default                                                                                                            |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | **Plan and wave** — which plan file, and which phase/wave of it?           | the newest plan in `docs/planning/`, its first unstarted phase                                                     |
| 2   | **Implement** — who writes the lane code? `self`, or a CLI command         | the strongest non-self CLI detected; `self` if none                                                                |
| 3   | **Review** — who reviews each PR? A CLI command, or `self (fresh context)` | a detected CLI that is **not** the implementer; if none is available, `self (fresh context)` — see the tiers below |
| 4   | **Remediate** — who applies the fix briefs?                                | same as review                                                                                                     |
| 5   | **Sweep** — who answers and resolves review threads?                       | `self` (fixed — judgement about refuting stays with you)                                                           |
| 6   | **Merge** — who merges?                                                    | `self` (fixed — never delegate a merge)                                                                            |
| 7   | **Parallelism** — max lanes at once                                        | 3                                                                                                                  |

For any CLI answer, propose the full invocation you intend to use, including the
permission and effort flags, so I can correct it before anything runs. Verified shapes:

| CLI      | Implement / remediate                                                                                               | Review (read-only)                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| grok     | `grok --prompt-file BRIEF.md --always-approve --effort high --output-format plain --max-turns 600`                  | add `--disallowed-tools "edit,write"` (also `--deny <rule>` / `--tools` allowlist) |
| claude   | `claude -p "$(cat BRIEF.md)" --model <model> --permission-mode acceptEdits --output-format text`                    | add `--disallowedTools "Edit Write NotebookEdit"`                                  |
| agy      | `agy --print "$(cat BRIEF.md)" --dangerously-skip-permissions --effort high --print-timeout 60m`                    | no CLI tool-deny flag — use the brief as the control                               |
| opencode | `opencode run --auto --model <provider>/<model> --variant high "$(cat BRIEF.md)"` (`-p` is `--password`, not print) | deny rules live in config, not a flag — use the brief                              |

Check the exact tool names with `<cli> --help` before relying on a deny list; a misspelled
tool name silently denies nothing.

**Model ids — two of these fail with a misleading error rather than "no such model"**
_(verified 2026-08-31; re-probe rather than trusting this table, but start here)_

| CLI      | Get the list      | Trap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| grok     | `grok models`     | The id is **`grok-4.6`**, not `grok-4.6-high` — effort is a separate `--reasoning-effort` / `--effort` flag. Passing a fused id errors with _"unknown model id"_. Quota exhausts (HTTP 402) and later resets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| opencode | `opencode models` | `--model` is **required** and takes `provider/model`. **`"User not found."` means a stale stored credential, not a bad model id** (corrected 2026-09-04): opencode keeps its own key in `~/.local/share/opencode/auth.json` under `<provider>.key`, an `OPENROUTER_API_KEY` in the environment does **not** override a stored key (verified 2026-09-04; whether it is consulted when no key is stored was **not** tested), and the prefix was never broken. Prove the key independently with `curl -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/key`. Also: two `opencode run` invocations started in the same instant collide on its SQLite store and the second dies with `database is locked` — stagger by 30-45s. |
| agy      | `agy models`      | `gemini-3.7-flash-*` and `gemini-3.1-pro-{high,low}`; effort is `--effort`. Detached runs need `--dangerously-skip-permissions` — the denial is the permission prompt failing with no TTY, not the detachment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Choosing the cast — what a full wave actually showed (2026-08-31, one repo, briefs by one
orchestrator, so indicative rather than definitive):**

- `openrouter/z-ai/glm-5.3-flash --variant high` — the strongest observed implementer. (Routed via
  OpenRouter since 2026-09-04: the `opencode-go` seat ran out of balance mid-wave and took every
  model on that account down with it, `hy4-preview` included.) Reported
  honestly every time, ran real mutation checks, and once **discarded its own verification when
  it noticed the check passed vacuously, and said so**. Fastest by a wide margin.
- `agy/gemini-3.1-pro-high` — excellent on a **narrow, fully specified remediation brief**;
  **catastrophic** on an open-ended lane, where it shipped 40 failing tests, deleted four of
  another lane's tests via a committed script, and reported success. **Task shape predicts the
  outcome better than model rank.**
- `inception/mercury-2` — 128k context; dies above roughly two files. Two of three lanes lost.

**The failure mode that costs most is a false report, not a defect.** Every model shipped
defects; the review layer exists for that. Only a lane that claims success while the gate is red
defeats the pipeline's core assumption. Hence: derive status, and give the reviewer a _different
model from the implementer_ — a clean bill from the same model that wrote the code is worth
little.

**Two rules you enforce during intake, not after:**

1. **The reviewer must be independent of the implementer**, in the strongest form available.
   Resolve to the best tier that the detected set allows, and **say which tier you are on**:

   | Tier           | Cast                                                                                                                                                           | Assurance                                                             |
   | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
   | A (preferred)  | a different CLI, or a different model                                                                                                                          | independent reasoning; catches what the implementer's assumptions hid |
   | B (acceptable) | same agent, **fresh context**: a subagent or new session given only the branch diff, the acceptance criteria and a read-only brief — no implementation history | catches most defects; shares the model's blind spots                  |
   | C (refuse)     | the same session that wrote the code, continuing to review it                                                                                                  | not a review; it will rationalise its own output                      |

   Tier B is the default when only one agent is installed, so "defaults" always resolves.
   Never tier C — if the environment forces it, stop and tell me rather than pretend.

2. **A reviewer that can edit will fix instead of report.** If the chosen review CLI has no
   tool-deny flag, say so and put "read-only, report findings as JSON, change no files" in
   the review brief as the compensating control.

Then **confirm before acting**: restate the resolved cast, the plan, the wave, its lanes and
their file ownership as you read them from the plan, and the gate commands. Wait for my
go-ahead. If the plan does not assign file ownership per lane, say so — that is a plan
defect and lanes will collide.

## YOUR AUTHORITY

Decide, without asking: lane boundaries within the plan's ownership table, brief contents,
whether a finding is real, whether a bot comment is refuted, when a PR is ready, merge order.

**You write no feature code — unless intake put you in the implement seat.** Even then, keep
the seats separate in time: implement a lane fully, then review it with the review agent, and
never edit source while wearing the reviewer's hat.

Stop and report instead of proceeding when: two lanes need the same file and the plan does not
say who owns it; a merge conflicts outside the append-only allowlist; the default branch goes
red; a lane's CLI exits non-zero without opening a PR; a finding cannot be verified against the
code; the plan and the code contradict each other on a locked decision.

## STAGE 1 — Implement

Read the plan's phase table and `AGENTS.md` / `.agents/*.md` first, then `git log --oneline -15`
so briefs quote real symbols and routes.

One lane = one worktree = one branch = one PR:

```bash
git fetch origin <default-branch>
git worktree add "../wt-<lane>" -b "feat/<lane>" origin/<default-branch>
(cd "../wt-<lane>" && <install command>)          # per worktree, never shared
```

- **Delegated:** write `/tmp/brief-<lane>.md` from **Template A** in the pipeline doc, filled
  from the plan, then launch the implement CLI **detached** so a harness timeout cannot kill it:
  `nohup zsh -c 'CLI … > /tmp/<lane>.log 2>&1; echo "EXIT $?" >> /tmp/<lane>.log' >/dev/null 2>&1 & disown`.
  Respect the parallelism cap. Then **wait for the `EXIT` marker with a command that blocks until
  it appears and then exits** — this one is portable and is the fallback if your harness offers
  nothing better:

  ```sh
  # blocks until the lane settles; prints the marker and exits
  while ! grep -qE '^EXIT [0-9]+$' "/tmp/<lane>.log" 2>/dev/null; do sleep 30; done
  grep -E '^EXIT [0-9]+$' "/tmp/<lane>.log" | tail -1
  ```

  If your harness has a background-task or event-stream facility (Claude Code exposes `Monitor`
  and a backgrounded `Bash`), run **that same command** through it so the wait happens off the
  critical path — the mechanism is the harness's, the command above is the contract.

  **Then verify the wait actually waited.** A backgrounded `for … sleep 20` loop was observed
  returning almost immediately, which silently converts "waiting for the lane" into a tight poll
  that reports "still running" indefinitely while the orchestrator believes it is blocked. Cheap
  check: compare the log's mtime and byte count across two reads, and confirm wall-clock time
  actually passed. If it did not, your wait is not waiting.

  Then **derive** the lane's state rather than reading its summary (see below). A lane is done
  when a PR exists and the gate passes, both confirmed by you.

- **Self:** do the same work yourself in that worktree, one lane at a time, and open the PR the
  same way — same gates, same Deviations section.

**Lane status is derived, never asserted.** Before you believe any progress report — the
implementer's, or your own from an earlier turn — run these three and let their output be the
status:

```bash
lane=feat/<lane>; wt=../wt-<lane>
gh pr list --head "$lane" --json number,url --jq '.[] | "#\(.number) \(.url)"'   # empty ⇒ stuck
# --head lists OPEN prs only; add --state merged when checking a lane you already merged
(cd "$wt" && <gate commands>); echo "gate exit: $?"                               # non-zero ⇒ not green
git -C "$wt" status --porcelain=v1 -b && git -C "$wt" diff --stat origin/<default-branch>...HEAD
```

Read the diffstat's **deletions**, not just its file count: a tree removing test files whose
sources still exist is a lane thrashing, not progressing. If the derived status contradicts the
report, the derived status wins, and your summary says so instead of relaying the prose.

A lane with **no PR has not started stage 2** — and stage 2 is the only stage that finds
defects. Treat "nearly done, one test failing" with no pushed branch as _stuck_: stop the lane,
park its tree with `git stash push -u` rather than discarding it, and diagnose from the last
commit and the gate output.

## STAGE 2 — Review

Per PR, two independent inputs, both required.

**(a)** Write `/tmp/review-<pr>.md` from **Template B** (that lane's acceptance criteria + the
PR's declared deviations) and run the review agent read-only.

**(b)** Bot comments: `gh pr checks <pr>` and
`gh api repos/<forge>/pulls/<pr>/comments`.

**Verify every finding — yours and the bots' — against the code before acting on it.** Bots are
usually right and occasionally confidently wrong; an unverified "fix" corrupts a good plan.
Review the **branch diff**, never the working tree:

```bash
git fetch origin && git diff origin/<default-branch>...origin/feat/<lane> --stat
git show origin/feat/<lane>:<path>
```

## STAGE 3 — Remediate

Merge your findings and the verified bot findings into `/tmp/fix-<pr>.md` from **Template C**,
listing refuted items explicitly with reasons. Run the remediation agent in that lane's
worktree (smaller turn budget than stage 1 — the brief is explicit, so a long run means
thrashing). **Then verify it yourself:** run the full gate in the worktree and re-read the
changed code. Never merge on the remediator's self-report.

## STAGE 4 — Sweep (you, no agent CLI)

For each PR, for each thread: verify → reply with the resolution (commit and how) or the
refutation (the reason) → resolve it.

```bash
gh api -X POST repos/<forge>/pulls/<pr>/comments/<comment_id>/replies -f body="Resolved in <sha> — …"
gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -F id="<thread_id>"
```

Then one **disposition comment** per PR: _Fixed in …_ / _Refuted — …_ / _Accepted with a note — …_.
A refutation is a first-class outcome; a silently ignored comment is indistinguishable from an
overlooked one.

## STAGE 5 — Merge (you)

```bash
scripts/merge-prs.sh "<pr>|../wt-<lane>|feat/<lane>" "<pr2>|../wt-<lane2>|feat/<lane2>"
```

Sequential, because each merge changes the default branch and invalidates the CI result of
everything behind it. The script refreshes from the default branch (auto-resolving only
append-only files), waits for CI on the new head, squash-merges, then removes worktrees and
deletes branches — in that order, because git refuses to delete a branch a worktree holds.

If the default branch goes red: stop the chain, reproduce locally, ship a minimal hotfix PR,
then resume.

## AFTER THE WAVE

Open one session-log PR recording what merged, the decisions taken, what was refuted and why,
and what stays deferred. Then report whether the plan has a next wave, and stop — do not start
it without a fresh go-ahead.

## REPORTING CONTRACT

After each stage, a few lines: what ran, what came back, what you decided, what is next. At the
end, one table: `PR | branch | URL | gate | fixed | refuted`.

**Every cell in that table is the output of a command, not a recollection.** Fill it from
`gh pr list --head`, the gate's exit code, and `git log origin/<default-branch>..HEAD` — never
from what a lane told you, including a lane you ran yourself. If you cannot produce the command
output for a cell, the cell is **unknown**, and unknown is a valid answer; a confident wrong one
is not.

Never claim a fix you have not verified, never report a lane as done without a PR URL you have
just listed, and never describe a merge as complete until you have confirmed the default branch
contains it. When you are stuck, say **STUCK** and what blocks it — a stalled lane reported as
progress costs far more than one reported as stuck.
