# @hexagen/reconciliation-engine — FROZEN

**Status:** Frozen as of Phase 6 architectural audit.

## Rationale

This package has **no runtime consumers** on the main application path:

- Not imported by `apps/web/` or `wire.ts`
- Not depended on by any other `@hexagen/*` package
- Only referenced in lint allowlists and firewall blocklists
- Architectural review classified it as "aspirational and high-risk — ceremonial architecture"

None of the `@hexagen/*` dependencies declared in `package.json` were actually imported by any source file.

## What was preserved

- **Domain layer:** `LLMResponse`, `StructuredLLMOutput`, `ProjectSpecLike`, `ArchitectureGraphLike`, `Patch`, `ReconciliationResult`, `Verdict`, `ReconciliationState` (including factory functions)
- **Application layer:** All port interfaces (`ReconciliationPort`, `CompareVerdictsPort`, `PromoteStatePort`, `ResolveConflictPort`)
- Use case classes were kept as they are thin wrappers around ports with no external deps

## What was removed

- All infrastructure adapters:
  - `DefaultASTReconciliationAdapter` (naive set-diff, never wired)
  - `DefaultVerdictComparatorAdapter` (never wired)
  - `MonotonicStatePromoterAdapter` (never wired)
  - `DefaultConflictResolverAdapter` (never wired)
- All test files and test doubles
- Unused dependencies from `package.json`:
  - `@hexagen/prompt-compiler`
  - `@hexagen/project-configuration`
  - `@hexagen/visualization`
  - `@hexagen/governance`
