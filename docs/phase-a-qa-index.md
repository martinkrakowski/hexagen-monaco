# Phase A QA Harness — Documentation Index

## Quick Reference

**Phase A = Adapter Introduction & Integration Testing**
- 3 new adapters across 3 packages
- 18 total tests (6 + 5 + 7)
- All testing, dependency, and rollback documentation
- NO CODE CHANGES — DOCUMENTATION & SCRIPT ONLY

---

## Documents Overview

### 1. Integration Test Specification
**File**: `docs/phase-8-remediation-integration-tests.md`

Complete test matrix and execution specification for all Phase A changes.

**Contains**:
- Test matrix (3 adapters, 18 tests)
- Individual test descriptions
- Sequential execution order (not parallel)
- Gate criteria for Phase B approval
- Failure recovery procedures

**Use this when**:
- Planning Phase A test execution
- Understanding what gets tested
- Identifying test dependencies
- Defining pass/fail criteria

---

### 2. Verification Script
**File**: `scripts/phase-a-verification.sh`

Automated harness that runs all Phase A verifications in one command.

**Usage**:
```bash
bash scripts/phase-a-verification.sh
```

**What it does**:
1. ✓ Runs `yarn build`
2. ✓ Runs `yarn typecheck` (per-package)
3. ✓ Runs `yarn lint:arch`
4. ✓ Runs all 18 Phase A tests (sequentially)
5. ✓ Verifies all gates
6. ✓ Produces structured report

**Expected result**: Exit code 0 with all gates PASS

**Time**: ~5-10 minutes

---

### 3. Dependency Check Documentation
**File**: `docs/phase-a-dependency-check.md`

Comprehensive guide for verifying cross-package dependencies and architectural invariants.

**Contains 7 verification procedures**:
1. manifest.yaml validation
2. Circular dependency detection
3. Barrel file export consistency
4. ESM extension consistency
5. Index.ts export validation
6. Package.json dependency verification
7. TypeScript path resolution

**Use this when**:
- Verifying manifest structure
- Checking for circular dependencies
- Validating export consistency
- Ensuring ESM compliance
- Troubleshooting module resolution

**Key invariants**:
- ✓ No circular dependencies
- ✓ All exports use `.js` extensions
- ✓ Barrels properly export adapters
- ✓ manifest.yaml structurally valid

---

### 4. Phase B Preconditions Checklist
**File**: `docs/phase-b-preconditions.md`

Complete checklist of all items required before Phase B can begin.

**Contains 12 verification sections**:
1. Phase A gate script verification
2. Reconciliation Engine tests (6)
3. Transaction System tests (5)
4. AI Pipeline tests (7)
5. Test count verification (18)
6. manifest.yaml validation
7. Lint error check
8. TypeCheck verification
9. Full build verification
10. Dependency verification
11. Documentation completeness
12. Sign-off

**Use this when**:
- Preparing to move from Phase A to Phase B
- Tracking verification completion
- Getting approvals/sign-offs
- Ensuring all gates are documented

**Key blocking items**:
- ✓ All 18 tests passing
- ✓ Build succeeds
- ✓ No lint errors
- ✓ manifest.yaml valid

---

### 5. Rollback Procedure
**File**: `docs/phase-a-rollback-procedure.md`

Step-by-step disaster recovery guide for rolling back Phase A if critical issues arise.

**Contains 6 phases**:
1. Pre-rollback assessment
2. Git rollback (SAFE approach)
3. File-level rollback (selective)
4. manifest.yaml rollback
5. Full build verification
6. Git history cleanup

**Rollback triggers** (when to use):
- ✗ Critical test failures (>3 tests)
- ✗ Circular dependency loop detected
- ✗ Build fails in dependent packages
- ✗ manifest.yaml corruption
- ✗ Unrecoverable type errors
- ✗ Architectural violations

**Methods provided**:
- Soft reset (keep changes, unstage)
- Hard reset (delete all changes)
- Selective rollback (per-file)
- Revert (safest, preserves history)

**Use this when**:
- Critical issue blocks Phase B
- Cannot fix issue within 2 hours
- Need to recover to pre-Phase A state

---

## Phase A Adapter Summary

### Adapter 1: ManifestPatchAdapter
**Package**: `@hexagen/reconciliation-engine`
**File**: `packages/reconciliation-engine/src/infrastructure/adapters/manifest-patch.adapter.ts`
**Tests**: 6 (in `packages/reconciliation-engine/src/__tests__/manifest-patch.adapter.test.ts`)

**Purpose**: Validates LLM-generated manifest patches
- Rejects duplicate add_node operations
- Validates payload structure
- Handles patch ordering constraints

### Adapter 2: SyncDelegatingManifestMutationAdapter
**Package**: `@hexagen/transaction-system`
**File**: `packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts`
**Tests**: 5 (in `packages/transaction-system/__tests__/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.test.ts`)

**Purpose**: Delegates manifest mutations to sync system
- Respects transaction boundaries
- Handles rollback scenarios
- Preserves mutation ordering

### Adapter 3: NLToDomainCommandAdapter
**Package**: `@hexagen/ai-pipeline`
**File**: `packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts`
**Tests**: 7 (in `packages/ai-pipeline/src/__tests__/adapters/nl-to-domain-command.adapter.test.ts`)

**Purpose**: Converts NL intents to domain commands
- Parses simple and complex intents
- Maps NL entities to domain entities
- Preserves command context

---

## Test Execution Workflow

### Option 1: Full Automated Verification (Recommended)
```bash
# Run everything in one go
bash scripts/phase-a-verification.sh

# Expected: Exit code 0, all gates PASS
```

### Option 2: Individual Test Verification
```bash
# Reconciliation Engine tests (6 tests)
yarn workspace @hexagen/reconciliation-engine test -- \
  --testNamePattern="ManifestPatchAdapter"

# Transaction System tests (5 tests)
yarn workspace @hexagen/transaction-system test -- \
  --testNamePattern="SyncDelegatingManifestMutationAdapter"

# AI Pipeline tests (7 tests)
yarn workspace @hexagen/ai-pipeline test -- \
  --testNamePattern="NLToDomainCommandAdapter"
```

### Option 3: Manual Verification (Detailed)
```bash
# Step 1: Verify manifest structure
python3 -c "import yaml; yaml.safe_load(open('.architecture/manifest.yaml'))" && echo "✓"

# Step 2: Check circular dependencies
yarn lint:arch

# Step 3: Verify exports
grep "manifest-patch" packages/reconciliation-engine/src/infrastructure/adapters/index.ts

# Step 4: Run tests (see Option 2)
```

---

## Gate Hierarchy

```
┌─────────────────────────────────────┐
│      PHASE_A_GATE (Master)          │  ← Must PASS for Phase B
├─────────────────────────────────────┤
│  RECONCILIATION_GATE (6 tests)      │
│  TRANSACTION_GATE (5 tests)         │
│  AI_PIPELINE_GATE (7 tests)         │
└─────────────────────────────────────┘
```

**All 3 sub-gates must PASS for PHASE_A_GATE to PASS**

---

## Pre-Phase B Approval Checklist

Before approving Phase B, verify:

- [ ] Read `docs/phase-8-remediation-integration-tests.md`
- [ ] Run `bash scripts/phase-a-verification.sh` → Exit code 0
- [ ] Review `docs/phase-a-dependency-check.md` procedures
- [ ] Complete `docs/phase-b-preconditions.md` checklist
- [ ] All 18 tests passing
- [ ] Build succeeds: `yarn build`
- [ ] TypeCheck passes: `yarn typecheck`
- [ ] Linter passes: `yarn lint:arch`
- [ ] manifest.yaml valid
- [ ] Code owner sign-off obtained
- [ ] QA verification sign-off obtained
- [ ] All items marked complete

---

## Common Issues & Solutions

### Issue: Test fails with "Cannot find module"
**Solution**: Check `.js` extension in imports (ESM requirement)
**Reference**: `docs/phase-a-dependency-check.md` → Section 4

### Issue: "Circular dependency detected"
**Solution**: Verify import direction (port → adapter)
**Reference**: `docs/phase-a-dependency-check.md` → Section 2

### Issue: "ManifestPatchAdapter not exported"
**Solution**: Add export to barrel file (infrastructure/adapters/index.ts)
**Reference**: `docs/phase-a-dependency-check.md` → Section 3

### Issue: manifest.yaml validation fails
**Solution**: Verify YAML syntax and adapter definitions
**Reference**: `docs/phase-a-dependency-check.md` → Section 1

### Issue: Need to rollback Phase A
**Solution**: Follow step-by-step rollback procedure
**Reference**: `docs/phase-a-rollback-procedure.md`

---

## Phase A → Phase B Transition

**When Phase A is complete**:
1. All gates PASS
2. All 18 tests PASS
3. Build succeeds
4. manifest.yaml valid
5. All preconditions met

**Then Phase B begins** with:
- Export pipeline integration
- Mutation boundary enforcement
- Cross-adapter communication patterns

---

## Document Map

```
docs/
├── phase-8-remediation-integration-tests.md  (Test matrix & execution)
├── phase-a-qa-index.md                       (This document)
├── phase-a-dependency-check.md              (Dependency verification)
├── phase-b-preconditions.md                 (Sign-off checklist)
└── phase-a-rollback-procedure.md            (Disaster recovery)

scripts/
└── phase-a-verification.sh                  (Automated harness)
```

---

## Key Files & Locations

### Phase A Adapters
| Adapter | File | Tests |
|---------|------|-------|
| ManifestPatchAdapter | `packages/reconciliation-engine/src/infrastructure/adapters/manifest-patch.adapter.ts` | `src/__tests__/manifest-patch.adapter.test.ts` |
| SyncDelegatingManifestMutationAdapter | `packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts` | `__tests__/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.test.ts` |
| NLToDomainCommandAdapter | `packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts` | `src/__tests__/adapters/nl-to-domain-command.adapter.test.ts` |

### Barrel Exports
- `packages/reconciliation-engine/src/infrastructure/adapters/index.ts`
- `packages/transaction-system/src/infrastructure/adapters/index.ts`
- `packages/ai-pipeline/src/infrastructure/adapters/index.ts`

### Manifest
- `.architecture/manifest.yaml`

---

## Support & Questions

For issues or questions, refer to:
1. **General**: This index document
2. **Test execution**: `docs/phase-8-remediation-integration-tests.md`
3. **Dependencies**: `docs/phase-a-dependency-check.md`
4. **Preconditions**: `docs/phase-b-preconditions.md`
5. **Rollback**: `docs/phase-a-rollback-procedure.md`
6. **Automated verification**: `bash scripts/phase-a-verification.sh`

---

**Phase A QA Status**: ✅ READY FOR EXECUTION

All documentation and scripts in place. Ready to proceed with Phase A verification.
