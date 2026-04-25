# AI-Driven Architecture Modification Pipeline — Implementation Plan

> **Version:** 1.0.0
> **Date:** 2026-04-25
> **Status:** Approved
> **Depends on:** Architectural remediation Phases 0–6 (all complete)

---

## 1. Pipeline Overview

```
User Intent (chat)
    │
    ▼
┌──────────────────┐
│  intent-compiler  │  Parse NL → DomainCommand, validate topology/cardinality
└────────┬─────────┘
         │ DomainCommand + IntentLineage
         ▼
┌──────────────────┐
│  prompt-compiler  │  Compile DomainCommand + current architecture → structured prompt
└────────┬─────────┘
         │ PromptTemplate (with Zod schema)
         ▼
┌──────────────────┐
│    local-llm      │  Send compiled prompt, receive structured JSON
└────────┬─────────┘
         │ StructuredLLMOutput (proposed manifest + graph)
         ▼
┌────────────────────┐
│ reconciliation-engine│  Diff proposed vs current, produce patches
└────────┬───────────┘
         │ ReconciliationResult (patches + verdicts)
         ▼
┌──────────────────┐
│ transaction-system │  Bind REM + lineage, commit or rollback
└────────┬─────────┘
         │ Committed patches
         ▼
┌──────────────────┐
│  manifest-patcher  │  Apply patches to manifest.yaml, run sync + lint:arch
└──────────────────┘
```

---

## 2. Existing Assets

| Package                 | Status | What Exists                                                                                           | What's Missing                                                  |
| ----------------------- | ------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `core-domain`           | Active | `DomainAST`, `DomainCommand`, `IntentLineage`, `TopologyInvariants`, `CardinalityInvariants`, `REM`   | Bridge from `ProjectSpec`/`ArchitectureGraph` ↔ `DomainAST`     |
| `intent-compiler`       | Frozen | Ports + domain types (`Gesture`, `ParsedGesture`, `TopologyCheckerPort`, etc.)                        | Adapters, tests, NL→command parser                              |
| `prompt-compiler`       | Active | `PromptCompileRequest` with `ProjectSpec`/`ArchitectureGraph`/`LinterReport`, `CompiledPromptAdapter` | Intent-aware prompt builder, Zod output schema per command type |
| `local-llm`             | Active | `CompiledPromptAdapterPort`, `LLMRequest` with `ZodSchema`, WebLLM adapter                            | Server-side structured output adapter                           |
| `reconciliation-engine` | Frozen | `StructuredLLMOutput`, `Patch`, `ReconciliationResult`, `Verdict`, ports                              | Structured diff adapter, tests                                  |
| `transaction-system`    | Active | `ExecuteTransactionUseCase` with REM+lineage, stable hash                                             | Patch-commit use case, rollback-on-lint failure                 |
| `agentic-interaction`   | Active | `HandleServerChatUseCase`, `ServerLLMRequestPort`                                                     | Architecture-modification intent handler                        |

## 3. Missing Package

| Package            | Purpose                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `manifest-patcher` | Apply `Patch[]` to `manifest.yaml`, invoke `yarn sync`, validate with `yarn lint:arch`, rollback on failure |

---

## 4. Phases

### Phase A — Bridge `core-domain` ↔ Real Contracts

**Goal:** Make `DomainAST`/`DomainCommand` constructable from the project's real runtime types.

**Why first:** Every downstream phase depends on converting the project's `ProjectSpec`/`ArchitectureGraph` into the `DomainAST` that `intent-compiler` and `topology/cardinality` invariants operate on.

| Step | Action                                                              | Produces                                                  |
| ---- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| A1   | Create `ManifestToDomainASTAdapter` in `core-domain/infrastructure` | `DomainAST` from `ProjectSpec` + `ArchitectureGraph`      |
| A2   | Create `DomainCommandToManifestPatchAdapter`                        | `Patch[]` from `DomainCommand[]` applied to `ProjectSpec` |
| A3   | Write tests for both adapters                                       | Round-trip: manifest → AST → command → patch → manifest   |
| A4   | Update barrel + manifest.yaml                                       | Export new adapter                                        |

**Gate:** `yarn build && yarn typecheck && yarn lint:arch && yarn test` passes. `DomainAST` can be round-tripped from/to real manifest data.

---

### Phase B — Unfreeze `intent-compiler`

**Goal:** Implement real adapters and NL→command parsing.

| Step | Action                                                 | Produces                                                                                             |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| B1   | Remove `FROZEN.md`, update barrel notice               | Package is active                                                                                    |
| B2   | Implement `ManifestAwareGestureParserAdapter`          | Parses NL user intent + current `DomainAST` into `DomainCommand[]` with confidence scoring           |
| B3   | Implement `TopologyValidatorAdapter`                   | Checks `DomainAST` against `TopologyInvariants` (acyclic, containment, degree)                       |
| B4   | Implement `CardinalityValidatorAdapter`                | Checks `DomainAST` against `CardinalityInvariants` (exactly, atLeast, atMost, between)               |
| B5   | Implement `ConsoleRejectEmitterAdapter`                | Emits `Rejection` events to logger                                                                   |
| B6   | Rewrite `ParseGestureUseCase`                          | Orchestrates: parse → topology check → cardinality check → emit rejections or return `ParsedGesture` |
| B7   | Write domain + adapter tests                           | Unit tests for each adapter + integration test for full parse pipeline                               |
| B8   | Update manifest.yaml, linter-config.yaml, package.json | Remove frozen status, add `@hexagen/project-configuration`, `@hexagen/visualization` deps            |

**Gate:** `ParseGestureUseCase` accepts a user intent string + current `DomainAST` → returns `DomainCommand[]` or `Rejection[]`. CI green.

---

### Phase C — Intent-Aware Prompt Compilation

**Goal:** Make `prompt-compiler` produce prompts + Zod schemas tailored to the specific `DomainCommand` type.

| Step | Action                                                          | Produces                                                                                             |
| ---- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| C1   | Add `intentCommands: DomainCommand[]` to `PromptCompileRequest` | Prompt compiler knows the intent                                                                     |
| C2   | Create command-type-specific output Zod schemas                 | e.g., `CreateNodeOutputSchema`, `BatchCommandOutputSchema`                                           |
| C3   | Create `IntentAwarePromptCompilerAdapter`                       | Builds system prompt with: current architecture + intent commands + governance rules + output schema |
| C4   | Wire Zod output schema into `CompiledPromptAdapter`             | LLM receives schema for structured JSON output                                                       |
| C5   | Write tests                                                     | Verify prompt contains intent context and correct output schema                                      |
| C6   | Update barrel + manifest                                        | Export new adapter                                                                                   |

**Gate:** `CompiledPromptAdapterPort.sendCompiledPrompt()` now carries a Zod schema that constrains LLM output to the shape of the requested architecture change. CI green.

---

### Phase D — Unfreeze `reconciliation-engine`

**Goal:** Implement structured diff between LLM-proposed architecture and current manifest.

| Step | Action                                                 | Produces                                                                                                             |
| ---- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| D1   | Remove `FROZEN.md`, update barrel notice               | Package is active                                                                                                    |
| D2   | Implement `StructuredDiffReconciliationAdapter`        | Compares `StructuredLLMOutput.manifest` against `currentManifest` (bounded context names, ports, edges) → `Patch[]`  |
| D3   | Implement `VerdictComparatorAdapter`                   | Accepts/rejects patches based on governance rules (no shared-kernel removal, no cross-boundary port injection, etc.) |
| D4   | Implement `MonotonicStatePromoterAdapter`              | Promotes reconciliation state monotonically                                                                          |
| D5   | Implement `GovernanceAwareConflictResolverAdapter`     | Resolves conflicts using `LinterReport` as authority                                                                 |
| D6   | Wire `ReconcileUseCase`                                | Orchestrates: diff → verdict → conflict resolve → state promote                                                      |
| D7   | Write domain + adapter tests                           | Unit: diff algorithm, verdict logic. Integration: full reconcile pipeline                                            |
| D8   | Update manifest.yaml, linter-config.yaml, package.json | Remove frozen, add `@hexagen/governance`, `@hexagen/project-configuration` deps                                      |

**Gate:** `ReconciliationPort.reconcile()` accepts `StructuredLLMOutput` + `ProjectSpec` → `ReconciliationResult` with validated patches. CI green.

---

### Phase E — Transaction Binding with Manifest Mutation

**Goal:** Extend `transaction-system` to commit patches to the manifest atomically.

| Step | Action                               | Produces                                                                                                       |
| ---- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| E1   | Create `CommitPatchesUseCase`        | Accepts `Patch[]` + `IntentLineage` → begins transaction → applies patches → validates → commits or rolls back |
| E2   | Create `ManifestMutationPort`        | Outbound port: `applyPatches(patches, manifestPath): Promise<Result<void>>`                                    |
| E3   | Create `YamlManifestMutationAdapter` | Implements `ManifestMutationPort` using `js-yaml` + `fs`                                                       |
| E4   | Create `LintValidationPort`          | Outbound port: `validateManifest(manifestPath): Promise<Result<LinterReport>>`                                 |
| E5   | Create `CliLintValidationAdapter`    | Implements `LintValidationPort` by shelling `yarn lint:arch`                                                   |
| E6   | Wire rollback logic                  | If `lint:arch` fails → rollback transaction → restore previous manifest from git                               |
| E7   | Write tests                          | Test: commit succeeds when patches valid. Test: rollback when lint fails.                                      |
| E8   | Update barrel + manifest             | Export new use case, ports, adapters                                                                           |

**Gate:** `CommitPatchesUseCase` atomically applies patches, validates with `lint:arch`, rolls back on failure. CI green.

---

### Phase F — End-to-End Orchestration

**Goal:** Wire the full pipeline through a new `ModifyArchitectureUseCase` in `agentic-interaction`.

| Step | Action                                                      | Produces                                                                                          |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| F1   | Create `ModifyArchitectureUseCase` in `agentic-interaction` | Orchestrates: intent-compiler → prompt-compiler → local-llm → reconciliation → transaction commit |
| F2   | Create `ArchitectureModificationPort`                       | Inbound port: `modifyArchitecture(intent, currentManifest, lineage): Promise<ModificationResult>` |
| F3   | Wire in `wire.ts`                                           | Inject all dependencies into `ModifyArchitectureUseCase`                                          |
| F4   | Create API route `POST /api/architecture/modify`            | Accepts `{ intent, lineage }` → calls `ModifyArchitectureUseCase`                                 |
| F5   | Add streaming feedback                                      | Stream intermediate states (parsing, compiling, reconciling, committing) as SSE events            |
| F6   | Write integration test                                      | Full pipeline: "Add a bounded context named 'billing'" → manifest updated → lint passes           |
| F7   | Update manifest.yaml, linter-config.yaml                    | Add `agentic-interaction` depends_on all pipeline packages                                        |

**Gate:** User can send a chat intent like "Add a bounded context named billing with an inbound REST port" and the manifest is updated, synced, and linted. CI green.

---

### Phase G — UI Integration

**Goal:** Surface the architecture modification pipeline in the governance assistant UI.

| Step | Action                                                       | Produces                                                                           |
| ---- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| G1   | Add "Architecture Modification" mode to governance assistant | Toggle between Q&A mode and modification mode                                      |
| G2   | Create `useArchitectureModification` hook                    | Calls `/api/architecture/modify`, streams intermediate states                      |
| G3   | Create `PatchReviewPanel` component                          | Shows proposed patches with accept/reject per-patch                                |
| G4   | Create `ManifestDiffView` component                          | Side-by-side diff of current vs proposed manifest                                  |
| G5   | Wire into `GovernancePanelWrapper`                           | Adds modification mode tab                                                         |
| G6   | Write E2E test                                               | Click modification mode → type intent → review patches → accept → manifest updated |

**Gate:** User can initiate architecture modification from the UI, review proposed changes, and confirm application. CI green.

---

## 5. Dependency Graph Between Phases

```
A (bridge) ──→ B (intent-compiler) ──→ C (intent-aware prompts) ──→ F (orchestration) ──→ G (UI)
                                        │                                      ▲
                                        ▼                                      │
                                     D (reconciliation) ──────────────────────┘
                                        │
                                        ▼
                                     E (transaction commit) ─────────────────┘
```

**C and D can proceed in parallel** after B is complete. **E can proceed in parallel** with C and D. **F requires C, D, and E** to be complete. **G requires F**.

---

## 6. Estimated Scope Per Phase

| Phase | New Files | Modified Files | Risk                                         |
| ----- | --------- | -------------- | -------------------------------------------- |
| A     | ~6        | ~4             | Low — pure adapter layer                     |
| B     | ~10       | ~6             | Medium — NL parsing is inherently fuzzy      |
| C     | ~6        | ~5             | Low — extending existing working package     |
| D     | ~10       | ~6             | Medium — diff algorithm needs careful design |
| E     | ~10       | ~4             | High — filesystem mutation + rollback        |
| F     | ~6        | ~4             | High — end-to-end integration                |
| G     | ~8        | ~4             | Low — UI layer only                          |

---

## 7. Acceptance Gates (All Phases)

1. Every package in the pipeline has ≥1 real runtime consumer on the main path
2. No package advertises authority it does not exercise
3. Pipeline is idempotent: same intent on same manifest → same result
4. Pipeline is atomic: lint failure → full rollback to pre-modification state
5. `lint:arch` passes after each phase
6. All existing tests continue to pass

---

## 8. Interaction Protocol

| Intent                        | Command                         |
| ----------------------------- | ------------------------------- |
| Start a phase                 | `develop Phase [letter]`        |
| Advance within phase          | `next step`                     |
| Authorise multi-file batching | `batch Phase [letter] step [N]` |
| Reject a proposal             | `reject this approach`          |
| Trigger orchestration         | `delegate [phase]`              |
