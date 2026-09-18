# PR-Agent LLM Reviewer Plan

## 1. Role vs Existing Bots (CodeRabbit / Qodo)

This PR-Agent instance **supplements** the existing Qodo and CodeRabbit workflows. Its unique job is to enforce `DESIGN.md` UI contracts (4px baseline, arbitrary Tailwind values, presentation-layer data boundaries) that are harder to express in deterministic linters without massive false positives. CodeRabbit remains the primary guardian for the architectural invariants defined in `best_practices.md` and ADRs.

## 2. Infrastructure & Workflow Contract (`.github/workflows/pr-agent.yml`)

The GitHub Action must strictly match the repository's security and execution profile:

- **Events**: `opened`, `reopened`, `ready_for_review`, and `issue_comment`.
- **Bot-Sender Skip**: `if: ${{ github.event.sender.type != 'Bot' }}` to prevent infinite comment loops.
- **Permissions**: `contents: read`, `pull-requests: write`, `issues: write`.
- **Secret Wiring**: `OPENROUTER_KEY` for the model endpoint, plus standard `GITHUB_TOKEN`.
- **Action Pin**: SHA-pinned `uses: the-pr-agent/pr-agent@<SHA>`.
- **Concurrency**: Grouped by PR to `cancel-in-progress` previous bot runs.
- **Environment Flags (`github_action_config`)**:
  - `auto_review`: `true`
  - `auto_describe`: `true`
  - `auto_improve`: `false` (reserved strictly for manual `/improve` commands to prevent noisy secondary comment streams)

_Note: `pull_request_target` will not be used._

## 3. Configuration & Context (`.pr_agent.toml`)

- **Model**: `openrouter/tencent/hy3`
- **Fallback Models**: `["openrouter/anthropic/claude-3.5-sonnet"]`
- **Token Caps**: `custom_model_max_tokens = 64000` (allowing Hy3 to utilize its expanded window while clipping runaway costs).
- **Context Cap**: `repo_context_max_lines = 3000` (raised from 500 to fit both the rubric and `best_practices.md`).
- **Context Files**: `repo_context_files = [".agents/PR_REVIEW_RUBRIC.md", "best_practices.md"]`.
- **Global Instructions**: Static (not path-dynamic).
- **Ignore Globs**: Fenced generated/human-authored paths (`.architecture/**`, `@generated` barrels, `packages/template-engine/templates/**`).

## 4. The Knowledge Rubric (`.agents/PR_REVIEW_RUBRIC.md`)

Rather than paraphrasing `DESIGN.md`, the rubric will rely on explicit citations and the established "Do not flag" rules from `best_practices.md`:

### Please do flag these:

- UI boundaries: Components violating `DESIGN.md §3.4` (passing semantic state or fetching data directly).
- Tailwind magic numbers: Violations of `DESIGN.md §4.8` (arbitrary values like `w-[347px]`).
- Verifier blind spots: Any parser or matcher inside a guard that misses a legal syntax form, or an exit code that swallows errors.

### Please do not flag these (Copied directly from best_practices.md):

- **Assertion style is settled**: Do not propose migrating `assert.*` to `expect()` or treat it as legacy (ADR-0044).
- **The manifest is a registry, not an inventory**: Do not ask for an entry to be added because a file exists (ADR-0057).
- **Repeated ESLint entries**: Scoped blocks replace options rather than merging them.
- **Canvas inline styles**: `DESIGN.md §4.9` documents a narrow exception: only `width`, `height`, `transform`, and `opacity` are permitted, and strictly within `apps/web/features/hexagon-canvas/adapters/CanvasNodeStyleAdapter.tsx`. All other inline styles are violations.

## 5. Required Companion Document Updates

Adding a third automated reviewer requires updating the repository's documentation roster:

1.  **`.agents/REVIEW.md`**: Add PR-Agent to the roster. Note that a passing check from PR-Agent does not equal a human review.
2.  **`.agents/README.md`**: Update the table of specs to include the new `PR_REVIEW_RUBRIC.md` (and clarify it is bot-facing, not agent-authored).
3.  **`.github/workflows/README.md`**: Describe the new PR-Agent Action and its trigger/secret requirements.
4.  **`AGENTS.md`**: Update the `Review Mode` pointer to reference PR-Agent alongside CodeRabbit and Qodo.
