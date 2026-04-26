# AI-Driven Architecture Modification Pipeline — Code Review & Remediation Summary

> **Document Type:** Code Review Analysis + Remediation Status
> **Review Scope:** Phases 0–8b implementation (all packages)
> **Date:** 2026-04-26
> **Branch:** `fix/agentic-architecture-remediation`

---

## Executive Summary

The AI-driven architecture modification pipeline is architecturally sound on the macro level (layers, dependencies, manifest compliance all pass). **Phase B remediation fixed 3 critical violations** (Violations #2, #3, #8-10). **7 violations remain open** (including the 2 Phase A infrastructure fixes: ManifestPatchAdapter and SSE/UI integration).

**Overall Assessment:** Core infrastructure is solid; critical transaction safety and state machine issues are resolved. NL parsing now propagates rich metadata. Production readiness improved significantly.

---

## Verification Status

| Check            | Status  | Notes                                                                          |
| ---------------- | ------- | ------------------------------------------------------------------------------ |
| `yarn build`     | ✅ PASS | 33/33 packages                                                                 |
| `yarn typecheck` | ✅ PASS | 55/55 tasks                                                                    |
| `yarn lint:arch` | ✅ PASS | "Architecture is compliant with manifest.yaml"                                 |
| `yarn test`      | ✅ PASS | 45/45 tasks (119 transaction-system, 61 ai-pipeline, 47 reconciliation-engine) |
| `yarn lint`      | ⚠️ FAIL | Pre-existing ESLint v9 flat-config issue (unrelated to AI pipeline)            |

---

## Phase-by-Phase Implementation

### Phase 0: PR Cleanup

- Closed PR #26 (270 files, mixed concerns)
- Deleted feature branch `feature/ai-driven-architecture-modification`
- Removed orphaned `@hexagen/ai-pipeline` directory and phantom dependencies

### Phase 1: Shared Types + Browser Compatibility

- Extracted shared types (`ArchitectureGraphLike`, `ProjectSpecLike`, `StructuredLLMOutput`, `LLMResponse`, `Patch`, `ReconciliationResult`) into `@hexagen/core-domain/mvk/v1/shared-types.ts`
- Added Web Crypto API for browser-compatible `TransactionId`
- Added subpath export `@hexagen/core-domain/mvk/v1`

### Phase 2a: Intent Compiler Unfreezing

- Implemented 4 concrete adapters:
  - `ManifestAwareGestureParserAdapter` — parses UI gestures into ParsedGesture with DomainAST
  - `TopologyValidatorAdapter` — validates Acyclic, Containment, DegreeConstraint, Connected invariants
  - `CardinalityValidatorAdapter` — validates Exactly, AtLeast, AtMost, Between invariants
  - `ConsoleRejectEmitterAdapter` — emits rejections to console with ISO timestamps
- Updated `ParseGestureUseCase` to orchestrate full validation pipeline
- 60 tests passing

### Phase 2b: NL-to-DomainCommand Parser

- Created `@hexagen/ai-pipeline` package with full DDD structure
- Defined `NLToDomainCommandParserPort` (inbound port)
- Implemented `NLToDomainCommandAdapter` with 7 NL patterns:
  - Pattern 1: "Add a bounded context named [NAME]"
  - Pattern 2: "Add a port [TYPE] to [CONTEXT] named [PORT_NAME]"
  - Pattern 3: "Rename [CONTEXT] to [NEW_NAME]"
  - Pattern 4: "Add an entity named [NAME] to [CONTEXT]"
  - Pattern 5: "Add a use case named [NAME] to [CONTEXT]"
  - Pattern 6: "Create a/an link/edge from [SOURCE] to [TARGET]"
  - Pattern 7: "Update/Modify/Change context [NAME] to [PROPERTY]"
- Created `ParsedIntent` domain model with confidence scoring
- 33 tests passing

### Phase 3: Reconciliation Engine Implementation

- Implemented 4 concrete adapters:
  - `StructuredDiffReconciliationAdapter` — compares LLM-proposed manifest vs current, produces `Patch[]`
  - `VerdictComparatorAdapter` — compares verdicts using governance rules
  - `MonotonicStatePromoterAdapter` — enforces monotonic state transitions
  - `GovernanceAwareConflictResolverAdapter` — resolves conflicts using governance rules
- Added `ManifestPatchPort` (outbound)
- Created `ReconcileUseCase` orchestrating: diff → verdict → conflict resolve → state promote
- 29 tests passing

### Phase 4: Transaction System Extensions

- Created `CommitPatchesUseCase` — accepts `Patch[] + IntentLineage`, transaction lifecycle, rollback on failure
- Created `ManifestMutationPort` (outbound) — defines `applyPatches()` and `restoreFromGit()`
- Created `SyncDelegatingManifestMutationAdapter` — delegates to `@hexagen/sync` for manifest writes
- Created `LintValidationPort` (outbound) — defines `validateManifest()`
- Created `CliLintValidationAdapter` — shells out to `yarn lint:arch`
- Created `DomainCommandToManifestPatchAdapter` — maps all 7 DomainCommand variants to Patch types
- 114 tests passing

### Phase 5: AI Pipeline Orchestration

- Added `PipelineStep` value object for step-level observability
- Updated `PipelineRun` to include `steps: PipelineStep[]`
- Created `ArchitectureModificationPort` (inbound) in `@hexagen/agentic-interaction`
- Created `ModifyArchitectureUseCase` — orchestrates full 5-step pipeline with step tracking
- Created `InMemoryPipelinePortsAdapter` with 6 in-memory port implementations
- Created wiring module `wire.architecture-modification.ts` with `PipelineMode` (in-memory | cloud)
- Created API routes:
  - `POST /api/architecture/modify` — returns `ModificationResult` as JSON
  - `GET /api/architecture/modify/stream` — SSE endpoint emitting step events
- 76 tests passing

### Phase 6: UI Integration

- Added "Q&A / Modify" tabs to `GovernancePanelWrapper`
- Created `useArchitectureModification` hook
- Created `PipelineStepIndicator`, `PatchReviewPanel`, `ManifestDiffView`, `ArchitectureModificationPanel` components
- 24 tests passing

### Phase 7: Cloud LLM Adapter

- Created `CloudLLMPipelineAdapter` implementing `SendStructuredRequestPort`
- Created `ProviderFallbackChain` domain model with env-var-only API keys
- Fallback on retryable errors (429, 5xx); non-retryable errors (401, 403) return immediately
- 15 tests passing

### Phase 8a: LintFilterPort Integration (Phase A)

- Created `LintFilterPort` (inbound port) for filtering patches based on lint violations
- Created `LinterReportFilterAdapter` — rejects patches targeting files with error-severity violations
- Enhanced `ReconcileUseCase` with optional `LintFilterPort` injection and `linterReport` parameter
- Filtering placed BEFORE verdict generation (data-driven, not hardcoded)
- 9 new test cases covering compliant reports, blocking violations, multiple errors, path traversal
- Registered `LintFilterPort` inbound + `LinterReportFilterAdapter` in `.architecture/manifest.yaml`
- Bridge between `@hexagen/governance` (domain model) and reconciliation workflow

### Phase 8b: Critical Path Fixes (Phase B)

Three critical violations fixed:

1. **Violation #2 (FIXED):** Added rollback to catch block in `CommitPatchesUseCase`
2. **Violation #3 (FIXED):** Added `promoteToPhase()` to `PromoteStatePort` interface + called it in `ReconcileUseCase` to advance state to "approved"
3. **Violations #8-10 (FIXED):** Propagated `intentType`, `confidence`, and `parameters` from NL adapter through `parseWithMetadata()` method

---

## Files Modified by Phase

### Phase 8b Remediation (9 files)

| #   | File                                                                                             | Change                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | `packages/transaction-system/src/application/use-cases/commit-patches.use-case.ts`               | Added rollback to catch block; moved transaction variable outside try scope                            |
| 2   | `packages/reconciliation-engine/src/application/ports/in/promote-state.port.ts`                  | Added `ReconciliationPhase` type + `promoteToPhase()` to port interface                                |
| 3   | `packages/reconciliation-engine/src/infrastructure/adapters/monotonic-state-promoter.adapter.ts` | Implemented `promoteToPhase()` with pending verdict clearing                                           |
| 4   | `packages/reconciliation-engine/src/application/use-cases/reconcile.use-case.ts`                 | Added call to `promoteToPhase("approved")` after processing accepted verdicts                          |
| 5   | `packages/ai-pipeline/src/application/ports/in/nl-parser.port.ts`                                | Added `NLParsingMetadata` interface + `parseWithMetadata()` method                                     |
| 6   | `packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts`               | Handler returns `{ commands, parameters }`; added confidence scores; implemented `parseWithMetadata()` |
| 7   | `packages/ai-pipeline/src/application/use-cases/parse-nl-intent.use-case.ts`                     | Calls `parseWithMetadata()` and propagates `intentType`, `confidence`, `parameters`                    |
| 8   | `packages/ai-pipeline/src/application/ports/in/index.ts`                                         | Re-exports `NLParsingMetadata`                                                                         |
| 9   | `packages/agentic-interaction/src/infrastructure/adapters/in-memory-pipeline-ports.adapter.ts`   | Added `parseWithMetadata()` to `InMemoryNLParserAdapter`                                               |

---

## Violations Status

| #    | Category                          | Status             | Notes                                                                       |
| ---- | --------------------------------- | ------------------ | --------------------------------------------------------------------------- |
| 1    | ManifestPatchPort missing adapter | ⚠️ OPEN            | Phase A deferred — adapter declared in manifest, no implementation yet      |
| 2    | Rollback on exception             | ✅ FIXED (Phase B) | Catch block now calls rollback + restoreFromGit                             |
| 3    | State phase transitions           | ✅ FIXED (Phase B) | `promoteToPhase()` called in ReconcileUseCase                               |
| 4    | Auto-accept all verdicts          | ⚠️ OPEN            | Still auto-accepts; lint filtering happens before but verdict is still true |
| 5    | Duplicate node creation           | ⚠️ OPEN            | Phase A addressed in sync-delegating adapter                                |
| 6-7  | NL pattern gaps                   | ✅ FIXED (Phase A) | Pattern 7 for update, pattern 6 supports edge/link                          |
| 8-10 | Parser propagation                | ✅ FIXED (Phase B) | `parseWithMetadata()` propagates intentType, confidence, parameters         |
| 11   | Stub UI patch data                | ⚠️ OPEN            | SAMPLE_PATCHES still empty; needs SSE wiring                                |
| 12   | Stub accept/reject                | ⚠️ OPEN            | No-op in hook; needs API endpoint                                           |
| 13   | No step_running SSE               | ⚠️ OPEN            | Only step_complete emitted                                                  |
| 14   | Dead branch in step update        | ⚠️ OPEN            | `replace("complete", "running")` never matches                              |
| 15   | Streaming fallback gap            | ⚠️ OPEN            | `streamStructuredRequest` uses only primary provider                        |

---

## Test Summary

| Phase     | Tests    | Coverage                                                                                    |
| --------- | -------- | ------------------------------------------------------------------------------------------- |
| 2a        | 60       | Gesture parsing, topology/cardinality validation, rejection emission                        |
| 2b        | 33       | NL pattern parsing, DomainCommand mapping, confidence scoring                               |
| 3         | 29       | Structured diff, verdict comparison, monotonic state promotion                              |
| 4         | 114      | Commit-patches use case, DomainCommand-to-Patch mapping, lint validation, rollback          |
| 5         | 76       | ModifyArchitectureUseCase, PipelineRun/PipelineStep lifecycle, API routes                   |
| 6         | 24       | useArchitectureModification hook, PatchReviewPanel, ManifestDiffView, PipelineStepIndicator |
| 7         | 15       | Cloud LLM adapter, provider config, fallback chain                                          |
| 8a        | +9       | LintFilterPort, LinterReportFilterAdapter, reconciliation with lint filtering               |
| **Total** | **~360** |                                                                                             |

---

## Remaining Work (P0 + P1)

### P0 — Must Fix (Critical Path)

| #   | Violation                                                        | Effort |
| --- | ---------------------------------------------------------------- | ------ |
| 1   | Implement `ManifestPatchAdapter` in reconciliation-engine        | ~3h    |
| 4   | Make verdict generation respect lint filtering (not auto-accept) | ~2h    |
| 11  | Wire real patches to `PatchReviewPanel` via SSE                  | ~3h    |
| 12  | Implement `acceptPatch`/`rejectPatch` API endpoints              | ~4h    |
| 13  | Emit `step_running` SSE events when steps begin                  | ~1h    |
| 14  | Fix dead branch in step transition logic                         | ~30m   |

### P1 — Should Fix (Significant Gaps)

| #   | Violation                                          | Effort |
| --- | -------------------------------------------------- | ------ |
| 5   | Add duplicate check to `applyAddNode`              | ~1h    |
| 15  | Add provider fallback to `streamStructuredRequest` | ~1h    |

---

## References

- **ADR-0010:** `.architecture/decisions/ADR-0010-ai-pipeline-phased-implementation.md`
- **Implementation Summary:** `docs/ai-pipeline-implementation-summary.md`
- **Full Review:** `docs/ai-pipeline-code-review.md`
