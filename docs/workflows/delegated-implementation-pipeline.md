# Delegated Implementation Pipeline

> **Ported from campaign-foundry, 2026-09-08.** The stage structure and the brief templates
> (A–D) carry over verbatim; they are process, not repo facts. **Every gate command and
> file-ownership example below was written for that repository.** In this one the gate is
> `yarn build && yarn typecheck && yarn lint && yarn test` — no coverage counter, no separate
> `lint:arch` (it is chained by `lint`), no `sync:check` (`sync` runs the generator). Where a
> command here disagrees with `.claude/skills/orchestrate-wave/SKILL.md`, **the skill wins.**

A reusable workflow for turning a committed plan into merged code with one **orchestrator**
agent and one or more **implementer** agents, without a human in the loop between waves.

Proven on this repo: 24 PRs (#39–#63) across five waves — planner, briefs API, wizard,
packaging, copy pools, motion generation — with a 100 % coverage gate held throughout.

> **The orchestrator never writes feature code.** It plans, delegates, reviews, remediates,
> sweeps, and merges. That separation is what makes the review pass adversarial instead of
> a self-check, and it is the single most valuable property of this pipeline.

---

## 0. Preconditions

1. **The plan is committed** (`docs/planning/YYYY-MM-DD_slug.md`) with: locked decisions
   (`D1…Dn`), verified current state, phased tasks with **file ownership per lane**,
   acceptance criteria per phase, and a definition of done. The pipeline delegates _from_
   the plan; a vague plan produces vague PRs.
2. **The repo states its own gates** (`AGENTS.md` / `CONTRIBUTING.md`): test runner,
   coverage threshold, lint, architecture rules, commit and PR conventions.
3. **CI runs on pull requests** and the forge CLI (`gh`) is authenticated.

---

## 1. Roles and CLIs

| Role             | Stage   | What it does                                                  | Runs as                                                  |
| ---------------- | ------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| **Orchestrator** | 1, 4, 5 | Writes lane briefs, sweeps bot threads, merges, keeps the log | The interactive session you are typing in                |
| **Implementer**  | 1       | One lane = one branch = one PR, inside its own git worktree   | An agent CLI, headless, one process per lane             |
| **Reviewer**     | 2       | Adversarial read-only pass per PR, against the branch diff    | Orchestrator subagents **or** a separate CLI (see below) |
| **Remediator**   | 3       | Applies a fix brief to an existing branch                     | An agent CLI, headless — usually the reviewer's          |

Any CLI can play any role; they are interchangeable and can differ per stage. Mixing them
is often the point: a cheap long-context model orchestrates, a fast one implements, a
strong one reviews.

### Verified headless invocations

Flags below were read from each CLI's `--help` on 2026-08-26. Re-check after upgrades.

| CLI          | Invocation                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **grok**     | `grok --prompt-file BRIEF.md --always-approve --effort high --output-format plain --max-turns 600`                    | **Use `--prompt-file`, never `-p`** — long briefs are truncated through `-p`.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **claude**   | `claude -p "$(cat BRIEF.md)" --permission-mode acceptEdits --output-format text`                                      | `--dangerously-skip-permissions` only in a sandbox. `--bg` returns immediately.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **agy**      | `agy --print "$(cat BRIEF.md)" --dangerously-skip-permissions --effort high --output-format text --print-timeout 60m` | No `--prompt-file`; raise `--print-timeout` (default 5 m) or long lanes are cut off.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **opencode** | `opencode run --auto --model openrouter/z-ai/glm-5.3-flash --variant high "$(cat BRIEF.md)"`                          | **`-p` is `--password` here, not print.** `--auto` is the permission bypass. **`--model` is required.** _"User not found."_ means a **stale stored credential** in `~/.local/share/opencode/auth.json`, not a broken prefix (corrected 2026-09-04) — and the environment variable does not override a stored key. Never start two `opencode run` invocations in the same instant: they collide on its SQLite store and the second dies with `database is locked`. See the model-id table in `orchestrator-kickoff-prompt.md`. |

Launch each one **detached from the orchestrator's task runner**, or a harness timeout
will kill a lane mid-flight:

```bash
nohup zsh -c 'CLI … > run.log 2>&1; echo "EXIT $?" >> run.log' >/dev/null 2>&1 &
disown
```

`setsid` does not exist on macOS — `nohup … & disown` is the portable form.

### Which CLI at which stage

| Stage           | Who runs it                                            | Command shape                                                                                     | Notes                                                                                      |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **1 Delegate**  | Implementer CLI, one process per lane, detached        | `CLI <brief> --<auto-approve> --<high effort> --max-turns 400-600`                                | Long-running (10–40 min). Needs write access and a generous turn budget.                   |
| **2 Review**    | Orchestrator subagents, **or** a CLI in read-only mode | `claude -p "$(cat review-brief.md)" --model <strong> --disallowedTools "Edit Write NotebookEdit"` | Deny the edit tools — a reviewer that can patch will "helpfully" fix instead of reporting. |
| **3 Remediate** | Implementer or reviewer CLI, same worktree             | same as stage 1 with `--max-turns 200-300`                                                        | Smaller budget: the brief is explicit, so a long run means it is thrashing.                |
| **4 Sweep**     | Orchestrator only                                      | `gh api …` (no agent CLI)                                                                         | Judgement about refuting a finding stays with the orchestrator.                            |
| **5 Merge**     | Orchestrator only                                      | `scripts/merge-prs.sh …`                                                                          | Never delegate a merge.                                                                    |

**Choosing, and falling back.** Pick the implementer for throughput and the reviewer for
rigour, and keep them on _different models_ — a model reviewing its own output rationalises
it. When a CLI dies mid-wave (quota, auth, crash), the brief is the unit of portability:
hand the same file to another CLI and re-run the lane. Lanes that already pushed keep their
PRs. Record the handover in the session log so the PR history stays explicable.

**Reviewer independence trade-off.** Orchestrator subagents inherit the whole session's
context, so their reviews are cheap and well-informed but share the orchestrator's blind
spots. A separate CLI costs a cold read of the diff and repo conventions, and buys a genuinely
independent opinion. Use subagents for routine lanes; use a separate CLI for the lane that
carries the most risk.

---

## 2. The pipeline

```
plan committed
      │
  ┌───▼──────────────┐   worktrees + lane briefs, one per parallel lane
  │ 1 DELEGATE       │──▶ implementer CLI (detached, background)  ──┐
  └──────────────────┘                                              │
  ┌──────────────────┐                                              │
  │ 2 REVIEW         │◀── PRs opened ───────────────────────────────┘
  │  adversarial     │──▶ findings per PR (JSON, file:line, failure scenario)
  └───┬──────────────┘
  ┌───▼──────────────┐   fix brief per PR = own findings + verified bot findings
  │ 3 REMEDIATE      │──▶ implementer CLI on the same branch
  └───┬──────────────┘
  ┌───▼──────────────┐   reply to every thread, resolve or refute with a reason
  │ 4 SWEEP          │──▶ disposition comment per PR
  └───┬──────────────┘
  ┌───▼──────────────┐   refresh from main → CI → squash-merge → cleanup
  │ 5 MERGE          │──▶ scripts/merge-prs.sh
  └───┬──────────────┘
      └─▶ next wave (repeat) → docs/session-log PR at the end
```

### Stage 1 — Delegate

Split the wave into **file-disjoint lanes**. Two lanes may not own the same file; where a
shared file is unavoidable (a barrel, a shared enum, a session log), name the exact seam
in both briefs — "add your field on its own line" — and expect the orchestrator to merge
it by hand once.

```bash
git fetch origin main
for b in feat/lane-a feat/lane-b feat/lane-c; do
  git worktree add "../wt-${b#*/}" -b "$b" origin/main
  (cd "../wt-${b#*/}" && yarn install --immutable)
done
```

Then launch one CLI per lane with its brief (template A).

### Lane status is derived, never asserted

**Do not take a lane's word for its own state.** Ask git and the forge, and let their output
_be_ the status. A lane is in exactly one of three states, and each is a command, not a claim:

```bash
lane=feat/e1-web; wt=../wt-e1-web

# 1. Does a PR exist? No PR = the lane is stuck, whatever its prose says.
gh pr list --head "$lane" --json number,url,isDraft --jq '.[] | "#\(.number) \(.url)"'

# 2. Is it green? The gate's exit code is the answer; the lane's summary is not.
(cd "$wt" && yarn build && yarn typecheck && yarn lint && yarn test)
echo "gate exit: $?"

# 3. What actually changed, and is the tree clean?
git -C "$wt" status --porcelain=v1 -b
git -C "$wt" log --oneline origin/main..HEAD
git -C "$wt" diff --stat origin/main...HEAD
```

Run these **before** believing any progress report, and again before opening stage 2 on a PR.

`gh pr list --head` lists **open** PRs only — after stage 5 a merged lane reads as empty, which
is not "stuck". Add `--state merged` (or `--state all`) when you are checking a lane you have
already merged.

The failure this prevents is specific and has now happened twice. A lane reported
_"in progress — 1 test file failing"_ with a confident root cause. The tree held five
failures across four files, none of them the diagnosed cause; a silent validation
regression that no failing test pointed at; ~2,000 lines of **test deletions** staged as
the recovery attempt; coverage 6 points under the gate; and no pushed branch at all. Every
one of those is visible in three commands. None of it was in the report.

Two consequences worth stating plainly:

- **A lane with no PR has not started stage 2.** The pipeline's value is in review →
  remediate → sweep; a lane that stalls before opening a PR never reaches the stage that
  catches things. When that lane's work was finally reviewed, it produced 17 findings, 13
  of them real — including one that silently rewrote a persisted policy on every save.
  Those defects existed the whole time; nothing had looked yet.
- **`git status` is part of the status.** A working tree that is deleting tests is a lane
  thrashing, not progressing. Read the diffstat's _deletions_, not just its file count.

When the derived status contradicts the report, the derived status wins — and say so in
your own summary rather than relaying the prose.

### Stage 2 — Review

For each PR, run an **adversarial reviewer against the branch diff, never the working
tree** (template B). In parallel, read the bot comments (Qodo, CodeRabbit, …) and
**verify each claim against the code before acting on it** — bots are usually right here
but not always, and an unverified "fix" is how a plan gets corrupted.

### Stage 3 — Remediate

Turn the union of your findings and the verified bot findings into one fix brief per PR
(template C), stating explicitly which items are **refuted** and why. Run it on the same
branch in the same worktree. Verify the result yourself (run the gate, re-read the changed
code) — never merge on the implementer's self-report.

### Stage 4 — Sweep

Reply to **every** thread, then resolve it. A refutation is a first-class outcome: state
the reason (an unavailable dependency, an inherited behaviour, a decision recorded in the
plan). Post one **disposition comment** per PR summarising fixed vs. refuted, so the PR
reads correctly for a human later.

```bash
gh api -X POST "repos/OWNER/REPO/pulls/$PR/comments/$COMMENT_ID/replies" -f body="…"
gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -F id="$THREAD_ID"
```

### Stage 5 — Merge

`scripts/merge-prs.sh "PR|WORKTREE|BRANCH" …` — sequential refresh → CI → squash-merge →
worktree/branch cleanup → fast-forward main. Sequential because every merge changes `main`
and invalidates the CI result of the PRs behind it.

After the last wave: one **session-log PR** recording what merged, the decisions taken,
what was refuted, and what stays deferred.

---

## 3. Prompt templates

### Template A — Lane brief (implementer)

```markdown
Mode: Implementer. You are lane <LANE> of wave <N> for <REPO_PATH>.
Work ONLY in the worktree <WORKTREE_PATH> (branch <BRANCH>, based on origin/main <SHA>).

Read first, in order:

1. The plan: <PLAN_PATH> — sections <SECTIONS>.
2. The repo contract: AGENTS.md and .agents/\*.md (architecture, testing, git, tech-stack).
3. The code you are about to change (paths below) — match its style and comment density.

State of main you are building on: <ONE PARAGRAPH: what previous waves landed that this
lane depends on, with the real symbol/route names>.

FILE OWNERSHIP — you own exactly these paths; touching anything else fails review:
<explicit list>
Shared seams with lane <OTHER> (coordinate, keep each addition on its own line):
<explicit list, or "none">

Deliver <TASKS: numbered, each with acceptance criteria from the plan>.

Rules:

- Gates before pushing: <build> && <typecheck> && <lint> && <test with coverage> && <arch lint>;
  commit; then <sync/check> on the committed tree.
- Tests live <WHERE>, one behaviour per test, no real clock/network/filesystem in unit tests.
- Never hand-edit generated files; change the generator/manifest and regenerate.
- Do not reference paths that do not exist. If the plan and the code disagree, implement the
  smallest faithful interpretation and record it under Deviations — never improvise silently.
- Conventional Commits, one logical change per commit, each ending with:
  Co-Authored-By: <AGENT NAME> <noreply@…>
- Open a PR against main with `gh pr create` (title = commit summary; body = what/why,
  verification incl. the coverage line, and a **Deviations** section). Do NOT merge.
- Append a session-log entry (Mode / Changes / Decisions / Left open).

Final message: PR URL, files changed, coverage line, deviations. Nothing else.
If you cannot produce a PR URL and a passing gate, say **STUCK** and what blocks it —
do not report progress. The orchestrator verifies both independently either way.
```

### Template B — Reviewer (orchestrator subagent, read-only)

```markdown
You are a meticulous, adversarial code reviewer. Repo: <REPO_PATH>.
Review PR #<N>, branch <BRANCH>, by diff against origin/main ONLY:
git fetch origin; git diff origin/main...origin/<BRANCH> --stat
git show origin/<BRANCH>:<path> # read files at the branch tip
Do NOT review the working tree. Do not modify repo files.
You MAY create a throwaway worktree under <SCRATCH_DIR> to run the suite and drive the
feature for real; remove it when done.

Spec (what this PR is supposed to do): <PASTE THE LANE'S ACCEPTANCE CRITERIA>.
Declared deviations to evaluate: <PASTE FROM THE PR BODY>.

Hunt specifically for:

- consumers of a changed contract that were missed (grep the whole repo, incl. the CLI);
- behaviour that changed silently (compare removed vs. added assertions);
- determinism: same input twice → same output; ordering that depends on file/map order;
- destructive edges: overwrite, delete, partial writes, races between concurrent callers;
- failure paths: what the user sees when a dependency is missing, slow, or malformed;
- tests that pass for the wrong reason (mocks that agree with themselves, unguarded skips,
  new coverage-ignore pragmas).

Return JSON: [{file, line, severity: "bug"|"risk"|"nit", summary, failure_scenario}]
sorted by severity, plus a one-paragraph verdict stating what you ran and what you observed.
```

### Template C — Fix brief (remediator)

```markdown
Mode: Implementer. Work ONLY in <WORKTREE_PATH> (branch <BRANCH>, PR #<N>).
[If main moved: first `git fetch origin && git merge --no-edit origin/main`, resolving
<APPEND-ONLY FILES> by keeping both sides.]
Read AGENTS.md and .agents/\*.md first.

Apply the findings below as Conventional Commits (each ending with the Co-Authored-By
trailer), keep <COVERAGE GATE>, run <FULL GATE>, commit, <sync check>, push. Do not open a
new PR or merge.

Findings — each was verified against the code:

1. **<Title> (bug).** <What is wrong, where, and the reproduction.> Fix: <the specific
   change>. Test: <what must prove it>.
2. …

Refuted — do NOT change these, and say why in your final message:

- <finding> — <reason>.

Final message: commits, coverage line, one bullet per finding stating fixed (how) or not
fixed (why). Nothing else.
```

### Template D — Sweep (orchestrator, per PR)

```markdown
For PR #<N>:

1. List every review thread and its comments (`gh api …/pulls/N/comments`,
   `gh api graphql … reviewThreads`).
2. For each finding: verify it against the code at the branch tip. Do not act on an
   unverified claim.
3. Reply to the thread with the resolution: the commit that fixed it and how, OR the
   reason it is refuted (unavailable dependency, inherited behaviour, a plan decision).
4. Resolve the thread.
5. Post one disposition comment: **Fixed in <shas>** — … / **Refuted** — … /
   **Accepted with a note** — …
   Never resolve a thread you did not answer, and never claim a fix you have not verified.
```

---

## 4. Invariants (each one learned the hard way)

| Rule                                                           | Because                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deliver the brief with `--prompt-file` (grok) or `"$(cat …)"`  | `grok -p` silently truncated a long brief; the lanes were reconstructed from the plan and drifted.                                                                                                                                                  |
| Launch detached (`nohup … & disown`)                           | A harness task timeout killed a 10-minute-old wave mid-flight; the detached rerun survived.                                                                                                                                                         |
| One lane = one worktree = one branch = one PR                  | Parallel lanes in one checkout corrupt each other's `node_modules` and index.                                                                                                                                                                       |
| File ownership is explicit and checked                         | The only cross-lane conflicts that occurred were in files no brief had assigned.                                                                                                                                                                    |
| Review the **branch diff**, never the working tree             | A review run against the working tree reviewed the wrong thing entirely and reported plan-level findings for a code PR.                                                                                                                             |
| Verify every bot finding before acting                         | Most were real; the wrong ones would have introduced bugs (e.g. "use the structured logger" for a logger this repo does not have).                                                                                                                  |
| Refutations are recorded on the PR                             | A silently ignored bot comment is indistinguishable from an overlooked one.                                                                                                                                                                         |
| Merge sequentially, re-verify CI after each refresh            | `main` went red once from a PR that was green before the PR ahead of it merged; the next merge caught it.                                                                                                                                           |
| No `--delete-branch` while a worktree holds the branch         | `gh pr merge --delete-branch` fails after a successful merge and looks like a merge failure.                                                                                                                                                        |
| Refresh **every** PR before merging, even one with no worktree | A spec of the form `PR                                                                                                                                                                                                                              |     | branch` used to skip the refresh and merge stale; the script now refreshes in a throwaway **detached** worktree (`git worktree add` refuses a branch checked out elsewhere). |
| Never name a shell local `path` in zsh                         | `path` is tied to `$PATH`; `local … path …` empties PATH inside the function, so every `git`/`awk`/`sort` call fails. It cost the merge helper its entire conflict-resolution path until a scenario test caught it.                                 |
| Lane status is derived, never asserted                         | A lane reported "1 test file failing" over a tree with 5 failures in 4 files, a silent regression, ~2,000 lines of staged test deletions, and no pushed branch. `gh pr list --head`, the gate exit code and `git status` would each have caught it. |
| No PR URL means the lane is stuck, not nearly done             | Stalling before stage 2 skips the only stage that finds defects. The lane in question carried 13 real findings that surfaced the moment a review finally ran.                                                                                       |
| Read deletions in the diffstat, not just files changed         | The "recovery" that looked like progress was deleting the test suites whose sources still existed — a coverage gate can never be met that way.                                                                                                      |
| Keep `yarn install` per worktree, never share                  | Stale `node_modules` in the main checkout crashed the dev server long after the feature merged.                                                                                                                                                     |

---

## 5. Failure playbook

| Symptom                                                  | Action                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementer CLI exits non-zero (quota, auth, crash)      | Read its log tail; if lanes already pushed, keep them; finish the remaining lanes with a different CLI using the same brief. Note the handover in the session log.                                                                                                            |
| A lane reports progress but `gh pr list --head` is empty | Treat it as stuck. Read its log tail and `git -C <wt> status --porcelain -b`; if the tree is deleting tests or the branch is unpushed, stop the lane, park the tree (`git stash push -u`) rather than discarding it, and diagnose from the last commit — not from the report. |
| `main` goes red after a merge                            | Stop the merge chain, reproduce locally, ship a minimal hotfix PR first, then resume — do not merge more work onto a red main.                                                                                                                                                |
| CI red only on the runner (green locally)                | Suspect environment: runtime version, missing optional binary, timing. Compare `node -v` and the CI matrix before touching the test.                                                                                                                                          |
| Unexpected merge conflict                                | Never auto-resolve outside the append-only set. Resolve by hand, run the full gate, then re-run the merge.                                                                                                                                                                    |
| Two lanes both edited a "shared seam"                    | Merge by hand once, in the branch that merges second, and add the file to that lane's ownership list for the next wave.                                                                                                                                                       |

---

## 6. Worked example — three CLIs, one wave

A concrete run: **opencode** hosts the orchestrator on Nemotron 3 Ultra, **grok** implements
the lanes, **Claude Opus 4.8** reviews and remediates. Model ids below were taken from
`opencode models` and verified against each CLI on 2026-08-26.

| Stage                        | Tool                   | Model                            | Why this one                                                                                          |
| ---------------------------- | ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1 Delegate, 4 Sweep, 5 Merge | `opencode` interactive | `opencode/nemotron-3-ultra-free` | Orchestration is read-heavy and long-lived: many diffs, logs and threads, little generation.          |
| 1 Implement (per lane)       | `grok` headless        | default                          | Fast, high turn budget, comfortable in a worktree.                                                    |
| 2 Review, 3 Remediate        | `claude` headless      | `claude-opus-4-8`                | Different model from both the orchestrator and the implementer, so neither reviews its own reasoning. |

### 0 — Start the orchestrator

```bash
cd /path/to/repo
opencode --model opencode/nemotron-3-ultra-free
```

### 1 — Kick it off

Paste [`orchestrator-kickoff-prompt.md`](orchestrator-kickoff-prompt.md) into the orchestrator
session with nothing filled in: it detects the repo, plans and available CLIs, then asks one
batch of questions (plan and wave, who implements, who reviews, who remediates, parallelism)
with defaults you can accept wholesale, refuses a cast where the reviewer is also the
implementer, and confirms the lanes before touching anything.

```bash
sed -n '/^---$/,$p' docs/workflows/orchestrator-kickoff-prompt.md | tail -n +2 | pbcopy
```

### 2 — What the orchestrator then runs

```bash
# Stage 1 — one worktree + one detached grok per lane
git fetch origin main
for lane in editor-shell editor-selector; do
  git worktree add "../wt-$lane" -b "feat/$lane" origin/main
  (cd "../wt-$lane" && yarn install --immutable)
  nohup zsh -c "cd ../wt-$lane && grok --prompt-file /tmp/brief-$lane.md \
      --always-approve --effort high --output-format plain --max-turns 600 \
      > /tmp/$lane.log 2>&1; echo \"EXIT \$?\" >> /tmp/$lane.log" >/dev/null 2>&1 &
  disown
done

# Stage 2 — independent review of each PR, read-only
claude -p "$(cat /tmp/review-65.md)" --model claude-opus-4-8 --output-format text \
  --disallowedTools "Edit Write NotebookEdit" > /tmp/review-65.json

# Stage 3 — remediation on the same branch, smaller turn budget
nohup zsh -c "cd ../wt-editor-shell && claude -p \"$(cat /tmp/fix-65.md)\" \
    --model claude-opus-4-8 --permission-mode acceptEdits --output-format text \
    > /tmp/fix-65.log 2>&1; echo \"EXIT \$?\" >> /tmp/fix-65.log" >/dev/null 2>&1 &
disown

# Stage 4 — sweep (orchestrator itself, no agent CLI)
gh api repos/OWNER/REPO/pulls/65/comments --jq '.[] | "\(.id) \(.path):\(.line)"'
gh api -X POST repos/OWNER/REPO/pulls/65/comments/$ID/replies -f body="Resolved in <sha> — …"

# Stage 5 — merge
scripts/merge-prs.sh "65|../wt-editor-shell|feat/editor-shell" \
                     "66|../wt-editor-selector|feat/editor-selector"
```

### Swapping the cast

The stages are defined by role, not by vendor, so any row of the table in §1 can take any
seat. Two swaps worth knowing:

- **Claude Code as the host.** Run the orchestrator interactively and use its subagents for
  stage 2 instead of a separate `claude -p` — cheaper and context-rich, at the cost of
  reviewer independence (§1).
- **agy as implementer.** `agy --print "$(cat brief.md)" --dangerously-skip-permissions
--effort high --print-timeout 60m` — it has no `--prompt-file`, and the default 5-minute
  print timeout will truncate a lane, so raise it explicitly.

---

## 7. Adapting to another repo

Replace: the gate commands (§0.2), the append-only file list (`APPEND_ONLY` in
`scripts/merge-prs.sh`), the plan path convention, and the Co-Authored-By trailer. Everything
else is repo-agnostic. If the repo has no coverage gate, replace it with whatever the PR
must not regress — the pipeline needs one objective, machine-checkable acceptance signal per
lane, or the review stage has nothing to stand on.
