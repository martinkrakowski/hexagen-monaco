# AI Pipeline — Atomic Phased Development Plan

> **Phase:** D — Post-Implementation Cleanup & Correctness Wiring
> **Date:** 2026-04-26
> **Status:** READY FOR EXECUTION

---

## Executive Summary

Phase B+C fixed 14/15 violations but introduced an architectural correctness issue: the lint-aware verdict logic in `ReconcileUseCase` was **not wired** into the active pipeline (`ModifyArchitectureUseCase`), meaning violations were accepted regardless of lint status.

This plan covers three atomic phases:

| Phase   | Focus                                            | Duration | Gate                      |
| ------- | ------------------------------------------------ | -------- | ------------------------- |
| **D-1** | Wire `ReconcileUseCase` into active pipeline     | ~1h      | `yarn build && yarn test` |
| **D-2** | Remove deprecated `promoteState()`, finalize ADR | ~2h      | `yarn lint:arch`          |
| **D-3** | Browser E2E tests (SSE + patch UI flow)          | ~4h      | E2E test suite passes     |

---

## Phase D-1: Wire ReconcileUseCase (Correctness Fix)

### Problem

```
Active Pipeline (CURRENT):
  ModifyArchitectureUseCase
    └── reconciliationPort.reconcile(request)  ← Direct port call
        └── StructuredDiffReconciliationAdapter (no lint filtering)

Lint-Aware Logic (NOT REACHED):
  ReconcileUseCase
    └── generateVerdicts(patches, linterReport) ← NEVER EXECUTES
```

### Solution

Replace direct `reconciliationPort.reconcile()` call with `reconcileUseCase.execute()`, passing `linterReport` from the existing `linterReportProvider`.

### Files Changed (3)

| #   | File                                                                                     | Change                                                                                                                                                                             | Lines |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | `packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts` | Remove `reconciliationPort` from `ModifyArchitectureDeps`; add `reconcileUseCase: ReconcileUseCase`; update `reconcile()` to call `reconcileUseCase.execute()` with `linterReport` | ~15   |
| 2   | `packages/agentic-interaction/__tests__/use-cases/modify-architecture.test.ts`           | Update `createMockDeps()` factory pattern; add lint-rejection integration test                                                                                                     | ~30   |
| 3   | `apps/web/app/lib/wire.architecture-modification.ts`                                     | Import adapters from `@hexagen/reconciliation-engine`; construct fully-wired `ReconcileUseCase`; pass as single dep                                                                | ~20   |

### Detailed Changes

#### File 1: `modify-architecture.use-case.ts`

**Interface change (lines 47-58):**

```typescript
// BEFORE:
export interface ModifyArchitectureDeps {
  readonly reconciliationPort: ReconciliationPort;
  // ...
}

// AFTER:
export interface ModifyArchitectureDeps {
  readonly reconcileUseCase: ReconcileUseCase;
  // reconciliationPort REMOVED (not needed, owned internally)
  // ...
}
```

**`reconcile()` method change (lines 236-251):**

```typescript
// BEFORE:
private async reconcile(llmOutput: StructuredLLMOutput, intentId: string): Promise<Patch[]> {
  const currentManifest = await this.deps.manifestProvider();
  const request: ReconcileRequest = {
    structuredOutput: llmOutput,
    currentManifest,
    intentId,
  };
  const result = await this.deps.reconciliationPort.reconcile(request);
  if (!result.success) {
    throw new Error(`Reconciliation failed: ${result.errors.join("; ")}`);
  }
  return result.patches;
}

// AFTER:
private async reconcile(llmOutput: StructuredLLMOutput, intentId: string): Promise<Patch[]> {
  const currentManifest = await this.deps.manifestProvider();
  const linterReport = await this.deps.linterReportProvider();
  const request: ReconcileRequest = {
    structuredOutput: llmOutput,
    currentManifest,
    intentId,
  };
  const result = await this.deps.reconcileUseCase.execute(request, undefined, linterReport);
  if (!result.success) {
    throw new Error(`Reconciliation failed: ${result.errors.join("; ")}`);
  }
  return result.patches;
}
```

#### File 2: `modify-architecture.test.ts`

**Factory pattern in `createMockDeps()` (lines 195-232):**

```typescript
import {
  ReconcileUseCase,
  StructuredDiffReconciliationAdapter,
  VerdictComparatorAdapter,
  GovernanceAwareConflictResolverAdapter,
  MonotonicStatePromoterAdapter,
  LinterReportFilterAdapter,
} from "@hexagen/reconciliation-engine";
import type {
  LintFilterPort,
  LinterReportLike,
} from "@hexagen/reconciliation-engine";

function createMockDeps(overrides?: {
  lintFilterPort?: LintFilterPort;
}): ModifyArchitectureDeps {
  const reconcileUseCase = new ReconcileUseCase(
    new StructuredDiffReconciliationAdapter(),
    new VerdictComparatorAdapter(),
    new GovernanceAwareConflictResolverAdapter(),
    new MonotonicStatePromoterAdapter(),
    undefined, // manifestPatchPort (optional)
    overrides?.lintFilterPort ?? new LinterReportFilterAdapter(),
  );

  return {
    reconcileUseCase,
    // ... rest of deps
  };
}
```

**New lint-rejection test case (after line 260):**

```typescript
// --- Lint violation rejects patch ---
{
  const reportWithViolations: LinterReportLike = {
    timestamp: new Date().toISOString(),
    isCompliant: false,
    violations: [
      {
        ruleId: "no-shared-kernel",
        severity: "error",
        file: "billing",
        message: "Cannot add shared-kernel bounded context",
      },
    ],
    scannedFilesCount: 1,
  };

  const lintFilterPort: LintFilterPort = {
    filterPatches: (patches) =>
      patches.filter(
        (p) =>
          !reportWithViolations.violations.some(
            (v) => v.file === p.targetId && v.severity === "error",
          ),
      ),
  };

  const deps = createMockDeps({ lintFilterPort });
  const useCase = new ModifyArchitectureUseCase(deps);
  const result = await useCase.execute(
    "Add a bounded context named billing",
    ".architecture/manifest.yaml",
    makeLineage(),
  );

  assert.ok(result.success, "Pipeline should complete");
  if (result.success) {
    const billingPatchExists = result.value.patches.some(
      (p: Patch) => p.targetId === "billing",
    );
    assert.strictEqual(
      billingPatchExists,
      false,
      "Patch targeting lint-errored file should be rejected",
    );
  }
  console.log("✅ Test: lint violation rejects patch - passed");
}
```

#### File 3: `wire.architecture-modification.ts`

**New imports:**

```typescript
import {
  ReconcileUseCase,
  StructuredDiffReconciliationAdapter,
  VerdictComparatorAdapter,
  GovernanceAwareConflictResolverAdapter,
  MonotonicStatePromoterAdapter,
  LinterReportFilterAdapter,
} from "@hexagen/reconciliation-engine";
```

**New dep wiring:**

```typescript
const reconcileUseCase = new ReconcileUseCase(
  new StructuredDiffReconciliationAdapter(),
  new VerdictComparatorAdapter(),
  new GovernanceAwareConflictResolverAdapter(),
  new MonotonicStatePromoterAdapter(),
  undefined, // manifestPatchPort
  new LinterReportFilterAdapter(),
);

const deps: ModifyArchitectureDeps = {
  nlParser: new InMemoryNLParserAdapter(),
  promptCompiler: new InMemoryPromptCompilerAdapter(),
  llmSender,
  reconcileUseCase, // NEW: replaces reconciliationPort
  transactionManager: new InMemoryTransactionManager(),
  manifestMutation: new InMemoryManifestMutationAdapter(),
  lintValidation: new InMemoryLintValidationAdapter(),
  manifestProvider: async () => emptyManifest,
  architectureGraphProvider: async () => emptyArchitectureGraph,
  linterReportProvider: async () => emptyLinterReport,
};
```

### Verification Gates

| Gate      | Command                                            | Must Pass    |
| --------- | -------------------------------------------------- | ------------ |
| Build     | `yarn build`                                       | ✅ 33/33     |
| Typecheck | `yarn typecheck`                                   | ✅ 55/55     |
| Tests     | `yarn workspace @hexagen/agentic-interaction test` | ✅ All pass  |
| Arch lint | `yarn lint:arch`                                   | ✅ Compliant |

### Sub-Agent Delegation

| Task                                                  | Sub-Agent      | Scope                             |
| ----------------------------------------------------- | -------------- | --------------------------------- |
| D-1a: Update `ModifyArchitectureDeps` + `reconcile()` | Domain Worker  | agentic-interaction (application) |
| D-1b: Update `createMockDeps()` factory + lint test   | Test/QA Worker | agentic-interaction (**tests**)   |
| D-1c: Wire composition root                           | Adapter Worker | apps/web (infrastructure)         |

---

## Phase D-2: Remove Deprecated `promoteState()`, Finalize ADR

### Problem

`PromoteStatePort.promoteState()` is marked `@deprecated` but still called in `ReconcileUseCase` (line 60). This is technical debt — the deprecated method should be removed once all call sites are updated.

### Files Changed (3)

| #   | File                                                                                             | Change                                                       |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1   | `packages/reconciliation-engine/src/application/ports/in/promote-state.port.ts`                  | Remove `promoteState()` method, keep only `promoteToPhase()` |
| 2   | `packages/reconciliation-engine/src/infrastructure/adapters/monotonic-state-promoter.adapter.ts` | Remove `promoteState()` implementation                       |
| 3   | `.architecture/decisions/ADR-0011-ai-pipeline-architecture.md`                                   | Create ADR documenting ManifestPatchPort design decision     |

### Detailed Changes

#### File 1: `promote-state.port.ts`

```typescript
// REMOVE:
export interface PromoteStatePort {
  /**
   * @deprecated Use promoteToPhase() instead...
   */
  promoteState(
    state: ReconciliationState,
    verdictId: string,
  ): ReconciliationState;
  promoteToPhase(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): ReconciliationState;
}

// KEEP:
export interface PromoteStatePort {
  promoteToPhase(
    state: ReconciliationState,
    targetPhase: ReconciliationPhase,
  ): ReconciliationState;
}
```

#### File 2: `monotonic-state-promoter.adapter.ts`

Remove `promoteState()` method, keep only `promoteToPhase()` implementation.

#### File 3: Create ADR-0011

```markdown
# ADR-0011: AI Pipeline Architecture — ManifestPatchPort Design Decision

## Status

Accepted

## Context

Phase C code review identified that `ManifestPatchPort` in `reconciliation-engine` is declared in manifest.yaml but never implemented or wired into the active pipeline.

## Decision

The `ManifestPatchPort` interface will remain as a design artifact. The active pipeline uses `ManifestMutationPort` from `transaction-system` (implemented by `SyncDelegatingManifestMutationAdapter`), which handles atomic manifest mutations.

## Rationale

1. Two ports serve different layering purposes:
   - `ManifestMutationPort` (transaction-system): Atomic apply + rollback for transaction system
   - `ManifestPatchPort` (reconciliation-engine): Optional validation-only interface for standalone reconciliation use
2. `ReconcileUseCase` is designed for standalone use; the active pipeline uses `ModifyArchitectureUseCase` which delegates to `ReconcileUseCase` (D-1 fix)
3. Adding `ManifestPatchAdapter` would require `@hexagen/sync` as a direct dependency in `reconciliation-engine`, causing browser bundling issues

## Consequences

- `ManifestPatchPort` remains unused in production wiring
- Future standalone use of `ReconcileUseCase` could leverage this port
- If reconciliation-engine gains independent apply responsibility, implement `ManifestPatchAdapter` at that time
```

### Verification Gates

| Gate      | Command          | Must Pass    |
| --------- | ---------------- | ------------ |
| Build     | `yarn build`     | ✅ 33/33     |
| Typecheck | `yarn typecheck` | ✅ 55/55     |
| Tests     | `yarn test`      | ✅ All pass  |
| Arch lint | `yarn lint:arch` | ✅ Compliant |

---

## Phase D-3: Browser E2E Tests

### Scope

Validate the full user-facing flow with Playwright:

1. SSE event ordering (`step_running` → `step_complete` → `pipeline_complete`)
2. Patch UI acceptance flow (patches appear in `PatchReviewPanel` after pipeline completes)
3. Out-of-order SSE resilience (if client reconnects mid-stream)

### Files Changed

| #   | File                                                       | Change                        |
| --- | ---------------------------------------------------------- | ----------------------------- |
| 1   | `apps/web/__tests__/e2e/architecture-modification.spec.ts` | Create Playwright E2E test    |
| 2   | `apps/web/playwright.config.ts`                            | Create test configuration     |
| 3   | `apps/web/__tests__/e2e/global-setup.ts`                   | Create test environment setup |

### Test Cases

| Test                                | Description                                                           |
| ----------------------------------- | --------------------------------------------------------------------- |
| `full pipeline success`             | User enters intent → pipeline completes → patches shown               |
| `step_running before step_complete` | Each step emits `running` before `complete`                           |
| `lint error rejects patch`          | Intent triggers lint-error file → patch absent from result            |
| `error event formatted as SSE`      | Invalid JSON returns SSE error event, not JSON                        |
| `client reconnect resilience`       | Client disconnects mid-stream → reconnects → sees correct final state |

### Verification Gates

| Gate      | Command                | Must Pass   |
| --------- | ---------------------- | ----------- |
| E2E tests | `yarn playwright test` | ✅ All pass |

---

## Summary

| Phase     | Sub-Tasks                      | Files       | Time    |
| --------- | ------------------------------ | ----------- | ------- |
| D-1       | Wire ReconcileUseCase          | 3           | ~1h     |
| D-2       | Remove deprecated method + ADR | 3           | ~2h     |
| D-3       | Browser E2E                    | 3           | ~4h     |
| **Total** | **9 tasks**                    | **9 files** | **~7h** |

---

## Dependencies

```
D-1 ──► D-2 ──► D-3
  │       │
  │       └── D-2 can proceed independently but benefits from D-1 fixes
  │
  └── D-1 is prerequisite for D-3 (E2E tests validate D-1 wiring)
```

**D-1 must complete before D-3 begins.** D-2 can run in parallel with D-1 or after.

---

## Final Verification Checklist

After all phases complete:

- [ ] `yarn build` → 33/33 packages
- [ ] `yarn typecheck` → 55/55 tasks
- [ ] `yarn lint:arch` → Compliant
- [ ] `yarn test` → All tests pass
- [ ] `yarn playwright test` → All E2E tests pass
- [ ] ADR-0011 created in `.architecture/decisions/`
- [ ] Documentation updated (`ai-pipeline-implementation-summary.md`)
