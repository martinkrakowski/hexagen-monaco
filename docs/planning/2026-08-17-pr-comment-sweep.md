# PR Comment Sweep Plan and Execution Summary

## Objective

To sweep all open PR comments across the repository and either resolve them (by applying the requested fixes and tests) or refute them (with evidence).

## Execution

### PR 528: `execute-plan/...docs-audit-positioning`

- **Finding:** Missing ADR entries in `docs/index.md` (ADR-0059 through ADR-0064).
- **Resolution:** Applied the missing entries directly to the documentation index, committed, and resolved the thread.

### PR 529: `execute-plan/...foreign-repo-validation-adopt-bo`

- **Findings:** 5 edge-case architectural bugs:
  1. Layout overwrites missing a force flag in `adopt`.
  2. Non-atomic `bootstrap` writes leading to corrupt state on failure.
  3. Workspace glob misdetection failing silently instead of erroring out.
  4. Scope name collisions silently erasing mappings.
  5. Suppressed linter enforcement for communication edges when a layout is present.
- **Resolution:**
  - Added atomic fs renaming to `bootstrap` via temp files.
  - Added `--force` guard checks to `adopt`.
  - Added error handling for unsupported globs in `detectWorkspaces`.
  - Added duplicate context name checks to prevent collision overrides.
  - Preserved required communication enforcement in `arch-linter` by un-suppressing the `advisory` flag.
  - Quality gate tests passed, committed, and PR thread resolved.

### PR 530: `execute-plan/...fde-kit-report-ci-action-suppre`

- **Findings:** 5 logic bugs and 1 security flag:
  1. Transaction state machine transitions not atomic.
  2. Windows shell execution failing via `sh -c`.
  3. Missing baseline strict validation.
  4. Mermaid ID generation breaking syntax.
  5. GitHub Action `pull-requests: write` token scope limit.
  6. Remote mermaid dependency size warning (deferred).
- **Resolution:**
  - Added `compareAndSetStatus` to `transaction-manager.port.ts` and `in-memory-transaction-manager.adapter.ts`.
  - Wrapped transaction accept processing in a try-catch to properly update states to failed.
  - Modified Windows spawn to use `shell: process.platform === "win32"` instead of `sh -c`.
  - Ported strict validation logic (allowed keys, non-empty reasons, real calendar date validation for expires) to `baseline-read.ts`.
  - Changed Mermaid layout IDs from context names to deterministic sequential IDs (`ctx0`, `ctx1`, etc.).
  - Removed `pull-requests: write` from `sync-integrity-workflow.ts`.
  - Added a non-blocking note deferring the large Mermaid dependency.
  - Quality gate tests passed, committed, and PR thread resolved.

## Outcome

All PR review comments have been properly dispositioned, tests are green across all touched branches, and branches have been pushed to origin.
