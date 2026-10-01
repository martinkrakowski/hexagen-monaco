/**
 * Template A, byte for byte: the lines strictly between the ```markdown fence
 * lines of "Template A — Lane brief (implementer)" in the template's
 * `references/briefs.md`, with no trailing newline (the last line's own newline
 * belongs to the closing fence). The lane-host variant paragraph is part of it.
 *
 * It lives here exactly once. `render` fills the placeholders the command line
 * answers and resolves the variant paragraph against the named host's gate
 * policy. A test compares this constant with the template's own copy, so the
 * text the orchestrator reads and the text this bin writes cannot drift apart
 * without a red test.
 */
export const TEMPLATE_A = `Mode: Implementer. You are lane <LANE> of wave <N> for <REPO_PATH>.
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

Lane-host variant. It applies when this brief names a \`gate: targeted-only\` host or a remote lane host,
and it overrides every rule below that says to run the full gate, push, open a PR, or report a PR URL.
Then: Commit only. Never push, and never open a PR; the orchestrator fetches your commits back, runs
the full gate, pushes and opens the PR. Run the targeted checks <TARGETED_CHECKS: the exact commands>
this brief lists, not the full gate. Your final message is the commit list and the exit code of each
targeted check, in place of a PR URL. STUCK means a targeted check fails; it does not mean there is
no PR. Otherwise (no such host named) ignore this paragraph.

Rules:

- Before pushing, run the gate: \`npx --no-install hexagen-orchestration-gate\`, in the lane's own worktree, on the
  tree you are about to push.
- Tests live <WHERE>, one behaviour per test, no real clock/network/filesystem in unit tests.
- Never hand-edit generated files; change the generator/manifest and regenerate.
- Do not reference paths that do not exist. If the plan and the code disagree, implement the
  smallest faithful interpretation and record it under Deviations — never improvise silently.
- Conventional Commits, one logical change per commit, and no attribution trailer on any of them.
- Open a PR against main with \`gh pr create\` (title = commit summary; body = what/why,
  verification incl. the coverage line, and a **Deviations** section). Do NOT merge.

Final message: PR URL, files changed, coverage line, deviations. Nothing else.
(Under the lane-host variant: the commit list and targeted check exit codes instead.)
If you cannot produce a PR URL and a passing gate, say **STUCK** and what blocks it —
do not report progress. The orchestrator verifies both independently either way.`;
