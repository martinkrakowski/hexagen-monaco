# Sync CI Remediation Plan (Orchestrated)

**Baseline:** `.github/workflows/sync-integrity.yml` is functioning without syntax errors but lacks standard CI reliability safeguards.
**Scope:** Remediate and harden the GitHub Actions workflow for the sync integrity process without changing the underlying architecture.

This plan is optimized for sub-agent delegation. It must be executed in **Orchestrator Mode** (`.agents/ORCHESTRATOR.md`).

---

## 0. Delegation Strategy

- **Role: CI/Adapter Worker**
  - **Responsibilities:** Implements changes to GitHub Action YAML files, verifies shell script logic, and stages commits in isolated worktrees.
- **Role: Test/QA Worker**
  - **Responsibilities:** Verifies YAML validity (e.g. using `actionlint`), reviews simulated runs, ensures no regressions in the CI pipeline steps.
- **Role: Primary / Orchestrator**
  - **Responsibilities:** Collects decisions from the human for Wave 2, emits the Work Plan, spawns sub-agents, executes the Quality Gate, and merges PRs.

---

## Wave 1 — Reliability & Safeguards (Uncontroversial)

These items are approved for immediate delegation. The Orchestrator should emit a Work Plan for these and dispatch a **CI/Adapter Worker** to implement them in a single PR.

| ID       | Task                           | Sub-Agent | Acceptance Criteria                                                                                                              |
| -------- | ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **SA.1** | **Dependency Caching**         | CI Worker | Add `actions/cache@v4` (or `setup-node` `cache: 'yarn'`) for `.yarn/cache` and `.yarn/unplugged` before dependency installation. |
| **SA.2** | **Job Timeout Limits**         | CI Worker | Add `timeout-minutes: 60` to all long-running jobs to prevent runaway minute consumption.                                        |
| **SA.3** | **Artifact Upload on Failure** | CI Worker | Add `actions/upload-artifact@v4` with `if: failure()` to upload test results, coverage, and workspace logs.                      |
| **SA.4** | **Diagnostic Exit on Retry**   | CI Worker | Ensure the custom Yarn install retry loop outputs verbose diagnostic logs before exiting with code 1 if all attempts fail.       |

**Gate 1:** Worker proposes diff. Primary verifies YAML syntax and runs standard repo pre-flight checks before committing Wave 1.

---

## Wave 2 — Strictness & Reproducibility (Decisions Required)

These items require explicit human decisions before delegation. The Orchestrator must pause and prompt the human for a verdict on `D-SA.1` through `D-SA.5`.

### Decisions to Resolve

- **D-SA.1 (Runner Pin):** Do we pin `runs-on: ubuntu-latest` to a specific LTS (`ubuntu-22.04`) for strict reproducibility? (Yes/No)
- **D-SA.2 (Node 24 Env):** Do we keep `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`? (If kept, add a justification comment; if not, remove it).
- **D-SA.3 (`--allow-dirty`):** Do we remove `--allow-dirty` from the architectural verification step to strictly enforce a clean working tree? (Yes/No)
- **D-SA.4 (`persist-credentials`):** Should we explicitly comment that `persist-credentials: false` intentionally disables git push capabilities? (Yes/No)
- **D-SA.5 (Node Matrix):** Do we need a testing matrix across Node 20, 22, and 24 to guarantee compatibility for CLI consumers? (Yes/No)

### Delegation Execution (Post-Decision)

Once decisions are captured, dispatch the **CI/Adapter Worker** to implement the outcomes:

| ID       | Task                       | Sub-Agent | Acceptance Criteria                                                                               |
| -------- | -------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| **SA.5** | **Runner & Matrix Config** | CI Worker | YAML matches `D-SA.1` and `D-SA.5` verdicts. Matrix strategy implemented if approved.             |
| **SA.6** | **Env & Secrets Cleanup**  | CI Worker | YAML matches `D-SA.2` and `D-SA.4` verdicts. Necessary inline documentation comments are present. |
| **SA.7** | **Strict Verification**    | CI Worker | Sync CLI execution step matches `D-SA.3` verdict. `--allow-dirty` removed if rejected.            |

**Gate 2:** Worker proposes diff. Primary executes Quality Gate and confirms all decisions were implemented correctly before merge.
