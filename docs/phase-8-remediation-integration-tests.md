# Phase 8 Remediation — Integration Test Specification

## Overview

Phase A introduces three new adapters across the reconciliation, transaction, and AI pipeline packages. This document specifies the complete test matrix and integration verification requirements.

## Phase A Changes Summary

| Component | Package | File | Type | Purpose |
|-----------|---------|------|------|---------|
| ManifestPatchAdapter | @hexagen/reconciliation-engine | manifest-patch.adapter.ts | Adapter | Validates LLM-generated manifest patches for duplicate nodes |
| SyncDelegatingManifestMutationAdapter | @hexagen/transaction-system | sync-delegating-manifest-mutation.adapter.ts | Adapter | Delegates manifest mutations to sync system via transaction boundary |
| NLToDomainCommandAdapter | @hexagen/ai-pipeline | nl-to-domain-command.adapter.ts | Adapter | Converts natural language intents into domain commands |

---

## Test Matrix: Phase A Integration Validation

All tests must pass before Phase B can commence.

| Adapter | Package | Test File | Location | Test Count | Status | Gate |
|---------|---------|-----------|----------|------------|--------|------|
| ManifestPatchAdapter | @hexagen/reconciliation-engine | manifest-patch.adapter.test.ts | `packages/reconciliation-engine/src/__tests__/` | 6 | ⏳ Pending | `RECONCILIATION_GATE` |
| SyncDelegatingManifestMutationAdapter | @hexagen/transaction-system | sync-delegating-manifest-mutation.adapter.test.ts | `packages/transaction-system/__tests__/infrastructure/adapters/` | 5 | ⏳ Pending | `TRANSACTION_GATE` |
| NLToDomainCommandAdapter | @hexagen/ai-pipeline | nl-to-domain-command.adapter.test.ts | `packages/ai-pipeline/src/__tests__/adapters/` | 7 | ⏳ Pending | `AI_PIPELINE_GATE` |
| **TOTAL PHASE A TESTS** | | | | **18** | ⏳ Pending | `PHASE_A_GATE` |

### Test Case Descriptions

#### ManifestPatchAdapter (6 tests)
- ✅ Should reject patches with duplicate add_node targetIds
- ✅ Should accept mixed patches with different add_node targetIds
- ✅ Should accept patches with duplicate targetIds if not both add_node
- ✅ Should validate payload structure for each patch type
- ✅ Should handle empty patch lists
- ✅ Should enforce patch ordering constraints

#### SyncDelegatingManifestMutationAdapter (5 tests)
- ✅ Should delegate manifest mutations to sync system
- ✅ Should respect transaction boundaries
- ✅ Should handle rollback scenarios
- ✅ Should preserve mutation ordering
- ✅ Should validate delegation metadata

#### NLToDomainCommandAdapter (7 tests)
- ✅ Should parse simple domain commands from NL input
- ✅ Should handle complex multi-step intents
- ✅ Should map NL entities to domain entities
- ✅ Should validate command preconditions
- ✅ Should generate appropriate error messages for invalid input
- ✅ Should preserve command context across conversions
- ✅ Should handle edge cases and malformed input

---

## Test Execution Sequence

Tests must run **sequentially, not in parallel**, to ensure clean isolation between package contexts.

### Test Run Order

```bash
# Phase A Test Sequence
# =====================

# 1. Reconciliation Engine Tests
yarn workspace @hexagen/reconciliation-engine test -- --testNamePattern="ManifestPatchAdapter"

# 2. Transaction System Tests  
yarn workspace @hexagen/transaction-system test -- --testNamePattern="SyncDelegatingManifestMutationAdapter"

# 3. AI Pipeline Tests
yarn workspace @hexagen/ai-pipeline test -- --testNamePattern="NLToDomainCommandAdapter"
```

---

## Integration Verification Checklist

Before proceeding to Phase B, verify all items:

- [ ] All 18 Phase A tests passing
- [ ] No lint errors in modified files
- [ ] Manifest.yaml valid (architecture compliance confirmed)
- [ ] No circular dependencies introduced
- [ ] ESM extensions consistent across all adapters
- [ ] Index barrel files properly export all adapters
- [ ] Build succeeds without errors
- [ ] TypeCheck succeeds (excluding pre-existing web app issues)

---

## Cross-Package Dependency Validation

### Manifest Consistency Checks

```yaml
reconciliation-engine:
  exports:
    - ManifestPatchAdapter (new)
    - existing exports (unchanged)

transaction-system:
  exports:
    - SyncDelegatingManifestMutationAdapter (new)
    - existing exports (unchanged)

ai-pipeline:
  exports:
    - NLToDomainCommandAdapter (new)
    - existing exports (unchanged)
```

### Critical Invariants

1. **No Circular Dependencies**: Verify no package imports each other in a cycle
2. **Barrel Consistency**: All new adapters must be exported from `infrastructure/adapters/index.ts`
3. **ESM Extensions**: All imports must use explicit `.js` extensions in source
4. **Port Ownership**: Each adapter must clearly implement a specific port interface

---

## Gate Criteria

### RECONCILIATION_GATE
- ✅ manifest-patch.adapter.test.ts: 6/6 tests passing
- ✅ No lint errors in manifest-patch.adapter.ts
- ✅ TypeCheck passes for @hexagen/reconciliation-engine

### TRANSACTION_GATE
- ✅ sync-delegating-manifest-mutation.adapter.test.ts: 5/5 tests passing
- ✅ No lint errors in sync-delegating-manifest-mutation.adapter.ts
- ✅ TypeCheck passes for @hexagen/transaction-system
- ✅ No circular dependency with reconciliation-engine

### AI_PIPELINE_GATE
- ✅ nl-to-domain-command.adapter.test.ts: 7/7 tests passing
- ✅ No lint errors in nl-to-domain-command.adapter.ts
- ✅ TypeCheck passes for @hexagen/ai-pipeline
- ✅ No circular dependencies with other Phase A packages

### PHASE_A_GATE (Master Gate)
- ✅ All three sub-gates passing
- ✅ Full monorepo build succeeds
- ✅ yarn lint:arch passes
- ✅ No new type errors introduced
- ✅ Manifest.yaml valid and unchanged structure

---

## Failure Recovery

If any test fails:

1. **Immediate Action**: Do not proceed to Phase B
2. **Investigation**: Check error output and identify root cause
3. **Remediation**: Fix the adapter or test as needed
4. **Re-run**: Execute `scripts/phase-a-verification.sh` again
5. **Escalation**: Document issue in PR for review if cause unclear

---

## Notes

- TypeCheck may report pre-existing errors in `apps/web`. These are **not** Phase A blockers.
- All 18 tests must pass with exit code 0.
- Test execution must be deterministic (same result on repeated runs).
- No test data cleanup is required between phases (stateless test design).
