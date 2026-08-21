# Sync CI Remediation Plan (Orchestrated)

**Baseline:** `.github/workflows/sync-integrity.yml` is functioning without syntax errors (verified with `actionlint .github/workflows/sync-integrity.yml`, clean exit, 2026-08-20) but lacks standard CI reliability safeguards.
**Scope:** Remediate and harden the GitHub Actions workflow for the sync integrity process without changing the underlying architecture.

This plan is optimized for sub-agent delegation. It must be executed in **Orchestrator Mode** (`.agents/ORCHESTRATOR.md`).

---

## 0. Delegation Strategy

Agent shapes match this repo's established convention (see
`docs/planning/2026-08-20-remaining-work-implementation-prompt.md` §1 and
`docs/planning/2026-08-20-brownfield-ui-implementation-prompt.md` §1) — a prior
PR (`fec7a2dc`) had to correct exactly this class of imprecision (plain-text
agent-shape strings instead of `AGENTS.md`-correct quoted `subagent_type`
values), so it is spelled out explicitly here rather than left implicit.

| Role                       | Agent shape                                                | Responsibilities                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI/Adapter Worker**      | `subagent_type: "general"`, `isolation: worktree`          | Implements changes to GitHub Action YAML files, verifies shell script logic, and stages commits in isolated worktrees.                                                                                                                                                                                                                                  |
| **Test/QA Worker**         | `subagent_type: "general"` (may share the item's worktree) | Verifies YAML validity with `actionlint`; reviews the actual GitHub Actions run on the worker's branch (this repo has no local Actions simulator — a real push-and-watch run is the only reliable verification for workflow behavior); confirms no regression against the last green run on `main`.                                                     |
| **Primary / Orchestrator** | non-delegatable gate runner                                | Collects decisions from the human for Wave 2, emits the Work Plan, spawns sub-agents, executes the Quality Gate, and prepares PRs for human merge. Merge itself is a human gate (`.agents/REVIEW.md:83`, "Do not merge on a bot's say-so — merge is a human gate") — the Orchestrator never merges, regardless of how clean the Quality Gate result is. |

---

## Wave 1 — Reliability & Safeguards (Uncontroversial)

These items are approved for immediate delegation. The Orchestrator should emit a Work Plan for these and dispatch a **CI/Adapter Worker** to implement them in a single PR.

| ID       | Task                           | Sub-Agent | Acceptance Criteria                                                                                                              |
| -------- | ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **SA.1** | **Dependency Caching**         | CI Worker | Add `actions/cache@v4` (or `setup-node` `cache: 'yarn'`) for `.yarn/cache` and `.yarn/unplugged` before dependency installation. |
| **SA.2** | **Job Timeout Limits**         | CI Worker | Add `timeout-minutes: 60` to all long-running jobs to prevent runaway minute consumption.                                        |
| **SA.3** | **Artifact Upload on Failure** | CI Worker | Add `actions/upload-artifact@v4` with `if: failure()` to upload test results, coverage, and workspace logs.                      |
| **SA.4** | **Diagnostic Exit on Retry**   | CI Worker | Ensure the custom Yarn install retry loop outputs verbose diagnostic logs before exiting with code 1 if all attempts fail.       |

**Gate 1:** Worker proposes diff. Primary verifies YAML syntax with `actionlint .github/workflows/sync-integrity.yml` (must exit 0) and runs the repo's Quality Gate (`yarn build && yarn typecheck && yarn lint`, then `yarn test`, quoting the suite count) before committing Wave 1. A command that cannot run (missing binary, unreachable network) fails the gate — it is never treated as a pass.

---

## Wave 2 — Strictness & Reproducibility (Decisions Required)

These items require explicit human decisions before delegation. The Orchestrator must pause and prompt the human for a verdict on `D-SA.1` through `D-SA.5`.

### Decisions to Resolve

- **D-SA.1 (Runner Pin):** Do we pin `runs-on: ubuntu-latest` to a specific LTS (`ubuntu-22.04`) for strict reproducibility? (Yes/No)
- **D-SA.2 (Node 24 Env):** Do we keep `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`? (If kept, add a justification comment; if not, remove it).
- **D-SA.3 (`--allow-dirty`):** Do we remove `--allow-dirty` from the **"Verify Architecture (arch-linter, strict)"** step specifically (`.github/workflows/sync-integrity.yml:90-98`, currently `yarn workspace @hexagen/sync run cli sync --strict --allow-dirty`) to strictly enforce a clean working tree at that gate? (Yes/No) — `--allow-dirty` also appears on the earlier **"Execute Hardened Sync"** step (line 69, `sync --force --allow-dirty`); this decision covers the architecture-verification step only. If clean-tree enforcement should also apply to "Execute Hardened Sync," that is a separate decision — flag it, don't fold it in silently.
- **D-SA.4 (`persist-credentials`):** Should we explicitly comment that `persist-credentials: false` intentionally disables git push capabilities? (Yes/No)
- **D-SA.5 (Node Matrix):** Do we need a testing matrix across Node 20, 22, and 24 to guarantee compatibility for CLI consumers? (Yes/No)

### Delegation Execution (Post-Decision)

Once decisions are captured, dispatch the **CI/Adapter Worker** to implement the outcomes:

| ID       | Task                       | Sub-Agent | Acceptance Criteria                                                                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SA.5** | **Runner & Matrix Config** | CI Worker | YAML matches `D-SA.1` and `D-SA.5` verdicts. Matrix strategy implemented if approved.                                                                                                                                                                                                                                                                             |
| **SA.6** | **Env & Secrets Cleanup**  | CI Worker | YAML matches `D-SA.2` and `D-SA.4` verdicts. Necessary inline documentation comments are present.                                                                                                                                                                                                                                                                 |
| **SA.7** | **Strict Verification**    | CI Worker | The `yarn workspace @hexagen/sync run cli sync --strict --allow-dirty` invocation inside **"Verify Architecture (arch-linter, strict)"** (`sync-integrity.yml:90-98`) matches `D-SA.3`'s verdict — `--allow-dirty` removed from that step if rejected. **"Execute Hardened Sync"** (line 69) is untouched by this item; a change there requires its own decision. |

**Gate 2:** Worker proposes diff. Primary executes the same Quality Gate as Gate 1 (`yarn build && yarn typecheck && yarn lint && yarn test`, suite count quoted), re-runs `actionlint` against the changed workflow, and confirms each `D-SA.1`–`D-SA.5` verdict is reflected in the diff before preparing the PR for human merge.
