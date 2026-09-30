# Prompt templates A–D

The four brief templates `SKILL.md` dispatches from, in the order it names them. Each is a **shape**,
not a script: every `<ANGLE_BRACKET>` below is something you substitute, and a brief that leaves one
unfilled is an unfunded seat — the implementer inherits none of this conversation and has to guess.

Scrubbed from the source runbook in three ways, all of them load-bearing:

- **No attribution trailer.** Commits and PR bodies carry none.
- **No session-log entry is appended.** A lane reports on itself; the orchestrator owns the wave record.
- **One gate.** `npx --no-install hexagen-orchestration-gate`, named rather than spelled out as a command list, so
  there is no second copy of a project's step list to keep in sync.

## Template A — Lane brief (implementer)

```markdown
Mode: Implementer. You are lane <LANE> of wave <N> for <REPO_PATH>.
Work ONLY in the worktree <WORKTREE_PATH> (branch <BRANCH>, based on origin/main <SHA>).

Read first, in order:

1. The plan: <PLAN_PATH> — sections <SECTIONS>.
2. The repo contract: AGENTS.md and .agents/*.md (architecture, testing, git, tech-stack).
3. The code you are about to change (paths below) — match its style and comment density.

State of main you are building on: <ONE PARAGRAPH: what previous waves landed that this
lane depends on, with the real symbol/route names>.

FILE OWNERSHIP — you own exactly these paths; touching anything else fails review:
<explicit list>
Shared seams with lane <OTHER> (coordinate, keep each addition on its own line):
<explicit list, or "none">

Deliver <TASKS: numbered, each with acceptance criteria from the plan>.

Lane-host variant. It applies when this brief names a `gate: targeted-only` host or a remote lane host,
and it overrides every rule below that says to run the full gate, push, open a PR, or report a PR URL.
Then: Commit only. Never push, and never open a PR; the orchestrator fetches your commits back, runs
the full gate, pushes and opens the PR. Run the targeted checks <TARGETED_CHECKS: the exact commands>
this brief lists, not the full gate. Your final message is the commit list and the exit code of each
targeted check, in place of a PR URL. STUCK means a targeted check fails; it does not mean there is
no PR. Otherwise (no such host named) ignore this paragraph.

Rules:

- Before pushing, run the gate: `npx --no-install hexagen-orchestration-gate`, in the lane's own worktree, on the
  tree you are about to push.
- Tests live <WHERE>, one behaviour per test, no real clock/network/filesystem in unit tests.
- Never hand-edit generated files; change the generator/manifest and regenerate.
- Do not reference paths that do not exist. If the plan and the code disagree, implement the
  smallest faithful interpretation and record it under Deviations — never improvise silently.
- Conventional Commits, one logical change per commit, and no attribution trailer on any of them.
- Open a PR against main with `gh pr create` (title = commit summary; body = what/why,
  verification incl. the coverage line, and a **Deviations** section). Do NOT merge.

Final message: PR URL, files changed, coverage line, deviations. Nothing else.
(Under the lane-host variant: the commit list and targeted check exit codes instead.)
If you cannot produce a PR URL and a passing gate, say **STUCK** and what blocks it —
do not report progress. The orchestrator verifies both independently either way.
```

## Template B — Reviewer (orchestrator subagent, read-only)

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

## Template C — Fix brief (remediator)

```markdown
Mode: Implementer. Work ONLY in <WORKTREE_PATH> (branch <BRANCH>, PR #<N>).
[If main moved: first `git fetch origin && git merge --no-edit origin/main`, resolving
<APPEND-ONLY FILES> by keeping both sides.]
Read AGENTS.md and .agents/*.md first.

Apply the findings below as Conventional Commits, each with no attribution trailer. Run the
gate: `npx --no-install hexagen-orchestration-gate`. Commit, push. Do not open a new PR or merge. Under the lane-host variant (Template A), commit only:
never push.

Findings — each was verified against the code:

1. **<Title> (bug).** <What is wrong, where, and the reproduction.> Fix: <the specific
   change>. Test: <what must prove it>.
2. …

Refuted — do NOT change these, and say why in your final message:

- <finding> — <reason>.

Final message: commits, coverage line, one bullet per finding stating fixed (how) or not
fixed (why). Nothing else.
```

## Template D — Sweep (orchestrator, per PR)

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
