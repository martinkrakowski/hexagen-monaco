# AI-Driven Architecture Modification Pipeline — Implementation Summary

## Feature Description

The AI-Driven Architecture Modification Pipeline enables users to modify their project's architecture through natural language intent. The pipeline compiles user intent into domain commands, generates structured prompts for an LLM, reconciles the LLM's proposed changes against the current manifest, and atomically commits or rolls back patches — all governed by the existing MVK contracts (DomainAST, RRP, REM) and enforced by `lint:arch`.

**Pipeline flow:**

```
User Intent (NL chat)
  → ai-pipeline (parse NL → DomainCommand[])
  → prompt-compiler (compile command + architecture → structured prompt)
  → local-llm / cloud-llm (send prompt → StructuredLLMOutput)
  → reconciliation-engine (diff proposed vs current → Patch[])
  → transaction-system (bind REM + lineage → commit or rollback)
  → manifest patcher (apply patches, validate with lint:arch)
```

---

## Phase-by-Phase Implementation Detail

### Phase 0: PR Cleanup

- Closed PR #26 (270 files, mixed concerns)
- Deleted feature branch `feature/ai-driven-architecture-modification`
- Removed orphaned `@hexagen/ai-pipeline` directory and phantom dependencies

### Phase 1: Shared Types + Browser Compatibility

- Extracted `ArchitectureGraphLike`, `ProjectSpecLike`, `StructuredLLMOutput`, `LLMResponse`, `Patch`, `ReconciliationResult` from reconciliation-engine into `@hexagen/core-domain/mvk/v1/shared-types.ts`
- Updated reconciliation-engine to re-export from core-domain (86 → 12 lines, zero duplication)
- Added Web Crypto API (`crypto.subtle.digest`) for browser-compatible `TransactionId` alongside existing Node.js `createHash` path
- Added subpath export `@hexagen/core-domain/mvk/v1` to core-domain package.json

### Phase 2a: Intent Compiler Unfreezing

- Implemented 4 concrete adapters:
  - `ManifestAwareGestureParserAdapter` — parses UI gestures into ParsedGesture with DomainAST
  - `TopologyValidatorAdapter` — validates Acyclic, Containment, DegreeConstraint, Connected invariants
  - `CardinalityValidatorAdapter` — validates Exactly, AtLeast, AtMost, Between invariants
  - `ConsoleRejectEmitterAdapter` — emits rejections to console with ISO timestamps
- Updated `ParseGestureUseCase` to orchestrate: parse → topology check → cardinality check → emit rejections
- Added `src/__tests__` to tsconfig exclude to fix build errors
- 60 tests passing

### Phase 2b: NL-to-DomainCommand Parser

- Created `@hexagen/ai-pipeline` package with full DDD structure
- Defined `NLToDomainCommandParserPort` (inbound port) with `parse(intent: string): Promise<Result<DomainCommand[], Error>>`
- Implemented `NLToDomainCommandAdapter` — maps NL patterns (e.g., "Add a bounded context named billing") to `CreateNodeCommand`, `UpdateNodeCommand`, `CreateEdgeCommand`, etc.
- Created `ParsedIntent` domain model with confidence scoring
- Created `ParseNLIntentUseCase`
- 33 tests passing

### Phase 3: Reconciliation Engine Implementation

- Implemented 4 concrete adapters:
  - `StructuredDiffReconciliationAdapter` — compares LLM-proposed manifest vs current, produces `Patch[]`
  - `VerdictComparatorAdapter` — compares verdicts using governance rules (no shared-kernel removal, no cross-boundary port injection)
  - `MonotonicStatePromoterAdapter` — enforces monotonic state transitions (pending → diffing → verdict → approved/rejected)
  - `GovernanceAwareConflictResolverAdapter` — resolves conflicts using keyword-based governance rules
- **Added `ManifestPatchPort` (outbound)** — the missing outbound port identified in the review
- Created `ReconcileUseCase` orchestrating: diff → verdict → conflict resolve → state promote
- Deleted `FROZEN.md`
- 29 tests passing

### Phase 4: Transaction System Extensions

- Created `CommitPatchesUseCase` — accepts `Patch[] + IntentLineage`, begins transaction, applies patches, validates, commits or rolls back
- Created `ManifestMutationPort` (outbound) — defines `applyPatches()` and `restoreFromGit()`
- Created `SyncDelegatingManifestMutationAdapter` — **delegates to `@hexagen/sync`** for manifest writes (avoids two independent writers causing drift, per review feedback)
- Created `LintValidationPort` (outbound) — defines `validateManifest()`
- Created `CliLintValidationAdapter` — shells out to `yarn lint:arch`
- Created `DomainCommandToManifestPatchAdapter` — maps all 7 DomainCommand variants to Patch types
- Rollback logic: lint failure → rollback transaction → restore manifest from git
- 114 tests passing

### Phase 5: AI Pipeline Orchestration

- Added `PipelineStep` value object to `@hexagen/ai-pipeline` for step-level observability (name, status, timing, error, metadata)
- Updated `PipelineRun` to include `steps: PipelineStep[]`
- Created `ArchitectureModificationPort` (inbound) in `@hexagen/agentic-interaction`
- Created `ModifyArchitectureUseCase` — orchestrates the full 5-step pipeline with step tracking
- Created `InMemoryPipelinePortsAdapter` with 6 in-memory port implementations for testing
- Created wiring module `wire.architecture-modification.ts` with `PipelineMode` (in-memory | cloud)
- Created API routes:
  - `POST /api/architecture/modify` — returns `ModificationResult` as JSON
  - `GET /api/architecture/modify/stream` — SSE endpoint emitting `step_started`, `step_completed`, `step_failed`, `pipeline_completed`, `pipeline_failed` events
- Added `transpilePackages` for pipeline packages in `next.config.mjs`
- Fixed `ai-pipeline` tsconfig to emit JS (not declarations-only) so webpack can resolve it
- 76 tests passing

### Phase 6: UI Integration

- Added "Q&A / Modify" tabs to `GovernancePanelWrapper` using `@hexagen/ui` Tabs component
- Created `useArchitectureModification` hook — calls SSE endpoint, tracks step progress, returns `{ modify, abort, reset, steps, status, result, error, acceptPatch, rejectPatch }`
- Created `PipelineStepIndicator` component — shows 5 pipeline steps with pending/running/completed/failed/skipped icons and timing
- Created `PatchReviewPanel` component — displays proposed patches with type icon, target ID, payload details, accept/reject per-patch
- Created `ManifestDiffView` component — side-by-side diff with green additions, red removals, type badges
- Created `ArchitectureModificationPanel` — main panel composing all sub-components with intent input
- 24 tests passing

### Phase 7: Cloud LLM Adapter

- Created `CloudLLMPipelineAdapter` implementing `SendStructuredRequestPort` — sends prompts to OpenAI-compatible APIs with structured output, Zod schema passthrough, retryable error fallback
- Created `ProviderFallbackChain` domain model — supports primary/secondary cloud providers with `resolveFallbackChain()` and `resolveApiKey()` (env vars only, never hardcoded)
- Fallback on retryable errors (429, 5xx); non-retryable errors (401, 403) return immediately
- Provider metadata tracked in `LLMResponse.metadata` for pipeline step observability
- Updated wiring to support `PipelineMode: "cloud"` with fallback chain
- 15 tests passing

### Post-Phase Fix: Arch-Lint Violation

- Fixed `linter-config.yaml` indentation (invalid YAML prevented config loading)
- Added `@hexagen/sync` to transaction-system's `allowed_imports` in linter config
- `yarn lint:arch` now passes: "Architecture is compliant with manifest.yaml"

---

## Complete File List

### New Files (78)

**@hexagen/ai-pipeline** (new package — 23 files):

| #   | Path                                                                                 |
| --- | ------------------------------------------------------------------------------------ |
| 1   | `packages/ai-pipeline/package.json`                                                  |
| 2   | `packages/ai-pipeline/tsconfig.json`                                                 |
| 3   | `packages/ai-pipeline/tsconfig.test.json`                                            |
| 4   | `packages/ai-pipeline/jest.config.cjs`                                               |
| 5   | `packages/ai-pipeline/eslint.config.js`                                              |
| 6   | `packages/ai-pipeline/src/index.ts`                                                  |
| 7   | `packages/ai-pipeline/src/domain/index.ts`                                           |
| 8   | `packages/ai-pipeline/src/domain/parsed-intent.ts`                                   |
| 9   | `packages/ai-pipeline/src/domain/pipeline-run.ts`                                    |
| 10  | `packages/ai-pipeline/src/domain/pipeline-step.ts`                                   |
| 11  | `packages/ai-pipeline/src/application/index.ts`                                      |
| 12  | `packages/ai-pipeline/src/application/ports/in/index.ts`                             |
| 13  | `packages/ai-pipeline/src/application/ports/in/nl-parser.port.ts`                    |
| 14  | `packages/ai-pipeline/src/application/ports/out/index.ts`                            |
| 15  | `packages/ai-pipeline/src/application/use-cases/index.ts`                            |
| 16  | `packages/ai-pipeline/src/application/use-cases/parse-nl-intent.use-case.ts`         |
| 17  | `packages/ai-pipeline/src/infrastructure/index.ts`                                   |
| 18  | `packages/ai-pipeline/src/infrastructure/adapters/index.ts`                          |
| 19  | `packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts`   |
| 20  | `packages/ai-pipeline/src/__tests__/adapters/nl-to-domain-command.adapter.test.ts`   |
| 21  | `packages/ai-pipeline/src/__tests__/integration/parse-nl-intent.integration.test.ts` |
| 22  | `packages/ai-pipeline/src/__tests__/use-cases/parse-nl-intent.use-case.test.ts`      |
| 23  | `packages/ai-pipeline/src/__tests__/domain/pipeline-run.test.ts`                     |

**@hexagen/core-domain** (1 new file):

| #   | Path                                              |
| --- | ------------------------------------------------- |
| 24  | `packages/core-domain/src/mvk/v1/shared-types.ts` |

**@hexagen/intent-compiler** (5 new adapters + 5 test files):

| #   | Path                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- |
| 25  | `packages/intent-compiler/src/infrastructure/adapters/manifest-aware-gesture-parser.adapter.ts` |
| 26  | `packages/intent-compiler/src/infrastructure/adapters/topology-validator.adapter.ts`            |
| 27  | `packages/intent-compiler/src/infrastructure/adapters/cardinality-validator.adapter.ts`         |
| 28  | `packages/intent-compiler/src/infrastructure/adapters/console-reject-emitter.adapter.ts`        |
| 29  | `packages/intent-compiler/src/infrastructure/adapters/index.ts`                                 |
| 30  | `packages/intent-compiler/src/__tests__/adapters/manifest-aware-gesture-parser.adapter.test.ts` |
| 31  | `packages/intent-compiler/src/__tests__/adapters/topology-validator.adapter.test.ts`            |
| 32  | `packages/intent-compiler/src/__tests__/adapters/cardinality-validator.adapter.test.ts`         |
| 33  | `packages/intent-compiler/src/__tests__/adapters/console-reject-emitter.adapter.test.ts`        |
| 34  | `packages/intent-compiler/src/__tests__/use-cases/parse-gesture.use-case.integration.test.ts`   |

**@hexagen/reconciliation-engine** (5 new adapters + 5 test files + 1 outbound port):

| #   | Path                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- |
| 35  | `packages/reconciliation-engine/src/infrastructure/adapters/structured-diff-reconciliation.adapter.ts`     |
| 36  | `packages/reconciliation-engine/src/infrastructure/adapters/verdict-comparator.adapter.ts`                 |
| 37  | `packages/reconciliation-engine/src/infrastructure/adapters/monotonic-state-promoter.adapter.ts`           |
| 38  | `packages/reconciliation-engine/src/infrastructure/adapters/governance-aware-conflict-resolver.adapter.ts` |
| 39  | `packages/reconciliation-engine/src/infrastructure/adapters/index.ts`                                      |
| 40  | `packages/reconciliation-engine/src/application/ports/out/index.ts`                                        |
| 41  | `packages/reconciliation-engine/src/application/ports/out/manifest-patch.port.ts`                          |
| 42  | `packages/reconciliation-engine/src/application/use-cases/reconcile.use-case.ts`                           |
| 43  | `packages/reconciliation-engine/src/__tests__/structured-diff-reconciliation.adapter.test.ts`              |
| 44  | `packages/reconciliation-engine/src/__tests__/verdict-comparator.adapter.test.ts`                          |
| 45  | `packages/reconciliation-engine/src/__tests__/monotonic-state-promoter.adapter.test.ts`                    |
| 46  | `packages/reconciliation-engine/src/__tests__/governance-aware-conflict-resolver.adapter.test.ts`          |
| 47  | `packages/reconciliation-engine/src/__tests__/reconcile.use-case.test.ts`                                  |

**@hexagen/transaction-system** (5 new source files + 2 new ports + 1 use case + test files):

| #   | Path                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------- |
| 48  | `packages/transaction-system/src/application/ports/out/manifest-mutation.port.ts`                       |
| 49  | `packages/transaction-system/src/application/ports/out/lint-validation.port.ts`                         |
| 50  | `packages/transaction-system/src/application/use-cases/commit-patches.use-case.ts`                      |
| 51  | `packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts`  |
| 52  | `packages/transaction-system/src/infrastructure/adapters/cli-lint-validation.adapter.ts`                |
| 53  | `packages/transaction-system/src/infrastructure/adapters/domain-command-to-patch.adapter.ts`            |
| 54  | `packages/transaction-system/__tests__/application/use-cases/commit-patches.use-case.test.ts`           |
| 55  | `packages/transaction-system/__tests__/infrastructure/adapters/cli-lint-validation.adapter.test.ts`     |
| 56  | `packages/transaction-system/__tests__/infrastructure/adapters/domain-command-to-patch.adapter.test.ts` |

**@hexagen/agentic-interaction** (5 new source files + 3 test files):

| #   | Path                                                                                           |
| --- | ---------------------------------------------------------------------------------------------- |
| 57  | `packages/agentic-interaction/src/application/ports/in/architecture-modification.port.ts`      |
| 58  | `packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts`       |
| 59  | `packages/agentic-interaction/src/domain/provider-config.ts`                                   |
| 60  | `packages/agentic-interaction/src/infrastructure/adapters/cloud-llm-pipeline.adapter.ts`       |
| 61  | `packages/agentic-interaction/src/infrastructure/adapters/in-memory-pipeline-ports.adapter.ts` |
| 62  | `packages/agentic-interaction/__tests__/use-cases/modify-architecture.test.ts`                 |
| 63  | `packages/agentic-interaction/__tests__/domain/provider-config.test.ts`                        |
| 64  | `packages/agentic-interaction/__tests__/infrastructure/adapters/cloud-llm-pipeline.test.ts`    |

**apps/web — API routes + UI components + hook + wiring + tests** (14 new files):

| #   | Path                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------- |
| 65  | `apps/web/app/api/architecture/modify/route.ts`                                                      |
| 66  | `apps/web/app/api/architecture/modify/stream/route.ts`                                               |
| 67  | `apps/web/app/lib/wire.architecture-modification.ts`                                                 |
| 68  | `apps/web/features/governance-assistant/hooks/useArchitectureModification.ts`                        |
| 69  | `apps/web/features/governance-assistant/architecture-modification/ArchitectureModificationPanel.tsx` |
| 70  | `apps/web/features/governance-assistant/architecture-modification/PatchReviewPanel.tsx`              |
| 71  | `apps/web/features/governance-assistant/architecture-modification/ManifestDiffView.tsx`              |
| 72  | `apps/web/features/governance-assistant/architecture-modification/PipelineStepIndicator.tsx`         |
| 73  | `apps/web/features/governance-assistant/architecture-modification/index.ts`                          |
| 74  | `apps/web/__tests__/api/architecture/modify.test.ts`                                                 |
| 75  | `apps/web/__tests__/features/architecture-modification/useArchitectureModification.test.ts`          |
| 76  | `apps/web/__tests__/features/architecture-modification/PatchReviewPanel.test.ts`                     |
| 77  | `apps/web/__tests__/features/architecture-modification/ManifestDiffView.test.ts`                     |
| 78  | `apps/web/__tests__/features/architecture-modification/PipelineStepIndicator.test.ts`                |

### Modified Files (30)

| #   | Path                                                                           | Phase      | Change                                                                   |
| --- | ------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| 1   | `.architecture/manifest.yaml`                                                  | 2a,3,4,5,7 | Added packages, ports, adapters, dependencies                            |
| 2   | `.architecture/invariants/linter-config.yaml`                                  | fix        | Fixed YAML indentation; added sync to transaction-system allowed_imports |
| 3   | `packages/core-domain/package.json`                                            | 1          | Added `./mvk/v1` subpath export                                          |
| 4   | `packages/core-domain/src/mvk/v1/index.ts`                                     | 1          | Added `shared-types` export                                              |
| 5   | `packages/intent-compiler/tsconfig.json`                                       | 2a         | Added `src/__tests__` to exclude                                         |
| 6   | `packages/intent-compiler/FROZEN.md`                                           | 2a         | Updated with implementation notes                                        |
| 7   | `packages/intent-compiler/src/index.ts`                                        | 2a         | Added infrastructure exports                                             |
| 8   | `packages/intent-compiler/src/infrastructure/index.ts`                         | 2a         | Added adapter exports                                                    |
| 9   | `packages/intent-compiler/src/application/use-cases/parse-gesture.use-case.ts` | 2a         | Wired adapters into pipeline                                             |
| 10  | `packages/reconciliation-engine/FROZEN.md`                                     | 3          | **Deleted**                                                              |
| 11  | `packages/reconciliation-engine/package.json`                                  | 3          | Added dependencies                                                       |
| 12  | `packages/reconciliation-engine/tsconfig.json`                                 | 3          | Added `__tests__` exclude                                                |
| 13  | `packages/reconciliation-engine/src/index.ts`                                  | 3          | Updated exports                                                          |
| 14  | `packages/reconciliation-engine/src/infrastructure/index.ts`                   | 3          | Added adapter exports                                                    |
| 15  | `packages/reconciliation-engine/src/application/ports/index.ts`                | 3          | Added outbound ports                                                     |
| 16  | `packages/reconciliation-engine/src/application/use-cases/index.ts`            | 3          | Added reconcile use case                                                 |
| 17  | `packages/transaction-system/package.json`                                     | 4          | Added @hexagen/sync dependency                                           |
| 18  | `packages/transaction-system/tsconfig.json`                                    | 4          | Added `__tests__` exclude                                                |
| 19  | `packages/transaction-system/jest.config.cjs`                                  | 4          | Added sync module mapping                                                |
| 20  | `packages/transaction-system/src/application/index.ts`                         | 4          | Added use-case exports                                                   |
| 21  | `packages/transaction-system/src/application/ports/out/index.ts`               | 4          | Added new port exports                                                   |
| 22  | `packages/transaction-system/src/application/use-cases/index.ts`               | 4          | Added commit-patches export                                              |
| 23  | `packages/transaction-system/src/infrastructure/adapters/index.ts`             | 4          | Added new adapter exports                                                |
| 24  | `packages/agentic-interaction/package.json`                                    | 5,7        | Added pipeline package dependencies                                      |
| 25  | `packages/agentic-interaction/tsconfig.json`                                   | 5          | Updated includes/excludes                                                |
| 26  | `packages/agentic-interaction/src/application/index.ts`                        | 5          | Added use-case exports                                                   |
| 27  | `packages/agentic-interaction/src/application/ports/in/index.ts`               | 5          | Added modification port export                                           |
| 28  | `packages/agentic-interaction/src/application/use-cases/index.ts`              | 5          | Added modify-architecture export                                         |
| 29  | `packages/agentic-interaction/src/domain/index.ts`                             | 7          | Added provider-config exports                                            |
| 30  | `packages/agentic-interaction/src/infrastructure/index.ts`                     | 5,7        | Added adapter exports                                                    |
| 31  | `packages/ai-pipeline/package.json`                                            | 2b,5       | Updated dependencies                                                     |
| 32  | `packages/ai-pipeline/tsconfig.json`                                           | 2b,5       | Fixed emitDeclarationOnly                                                |
| 33  | `packages/ai-pipeline/src/domain/index.ts`                                     | 5          | Added pipeline-run, pipeline-step exports                                |
| 34  | `packages/sync/src/types/index.ts`                                             | 4          | Added BoundedContext type export                                         |
| 35  | `apps/web/features/governance-assistant/GovernancePanelWrapper.tsx`            | 6          | Added Q&A / Modify tabs                                                  |
| 36  | `apps/web/next.config.mjs`                                                     | 5          | Added transpilePackages for pipeline packages                            |
| 37  | `apps/web/package.json`                                                        | 5          | Added dependencies                                                       |
| 38  | `yarn.lock`                                                                    | 2b,4       | Dependency updates                                                       |

---

## Test Summary

| Phase     | Tests    | Key Coverage                                                                                                       |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 2a        | 60       | Gesture parsing, topology/cardinality validation, rejection emission, integration pipeline                         |
| 2b        | 33       | NL pattern parsing, DomainCommand mapping, confidence scoring, error handling                                      |
| 3         | 29       | Structured diff, verdict comparison, monotonic state promotion, conflict resolution, reconcile orchestration       |
| 4         | 114      | Commit-patches use case (success + failure), DomainCommand-to-Patch mapping, lint validation, rollback             |
| 5         | 76       | ModifyArchitectureUseCase (5-step pipeline + failure at each step), PipelineRun/PipelineStep lifecycle, API routes |
| 6         | 24       | useArchitectureModification hook, PatchReviewPanel, ManifestDiffView, PipelineStepIndicator                        |
| 7         | 15       | Cloud LLM adapter (success, no keys, fallback, all-fail, non-retryable, Zod validation, metadata), provider config |
| **Total** | **~351** |                                                                                                                    |

## Final Verification

```
yarn build     → 33/33 packages ✅
yarn typecheck → 55/55 tasks ✅
yarn lint:arch → "Architecture is compliant with manifest.yaml" ✅
```
