# Phase B Preconditions Checklist

## Overview

Before proceeding from Phase A to Phase B, all items in this checklist must be verified and marked complete. Phase B cannot begin until all gates pass and all preconditions are satisfied.

---

## Quick Status

| Precondition                        | Status     | Verified By                                     |
| ----------------------------------- | ---------- | ----------------------------------------------- |
| Phase A gate script passes          | ⏳ Pending | `scripts/phase-a-verification.sh`               |
| All 18 Phase A tests passing        | ⏳ Pending | Test output report                              |
| manifest.yaml valid                 | ⏳ Pending | `yarn lint:arch`                                |
| No lint errors in modified packages | ⏳ Pending | Per-package lint run                            |
| Final build succeeds                | ⏳ Pending | `yarn build`                                    |
| Dependency check passed             | ⏳ Pending | `docs/phase-a-dependency-check.md`              |
| Rollback procedure documented       | ✓ Complete | `docs/phase-a-rollback-procedure.md`            |
| Integration tests documented        | ✓ Complete | `docs/phase-8-remediation-integration-tests.md` |

---

## Checklist: Verification Steps

### PHASE A GATE VERIFICATION

#### ☐ 1. Run Phase A Verification Script

```bash
bash scripts/phase-a-verification.sh
```

**Expected Result**: Exit code 0, all gates PASS
**Location**: Script output
**Time Limit**: 5-10 minutes
**Blocking**: YES — must pass before continuing

**Verification**:

- [ ] Script runs without errors
- [ ] Exit code is 0
- [ ] Console output shows "PHASE A VERIFICATION: ALL GATES PASS"
- [ ] No warnings or unexpected failures
- [ ] Log file shows all three sub-gates passing

---

### TEST SUITE VERIFICATION

#### ☐ 2. Reconciliation Engine Tests (6 tests)

```bash
yarn workspace @hexagen/reconciliation-engine test -- \
  --testNamePattern="ManifestPatchAdapter"
```

**Expected Result**: 6/6 tests passing
**Location**: `packages/reconciliation-engine/src/__tests__/manifest-patch.adapter.test.ts`
**Test File**: `manifest-patch.adapter.test.ts`

**Verification**:

- [ ] All 6 tests pass
- [ ] No test skips or pending tests
- [ ] Execution time < 30 seconds
- [ ] Coverage report generated (if applicable)

**Tests to Pass**:

1. [ ] Should reject patches with duplicate add_node targetIds
2. [ ] Should accept mixed patches with different add_node targetIds
3. [ ] Should accept patches with duplicate targetIds if not both add_node
4. [ ] Should validate payload structure for each patch type
5. [ ] Should handle empty patch lists
6. [ ] Should enforce patch ordering constraints

#### ☐ 3. Transaction System Tests (5 tests)

```bash
yarn workspace @hexagen/transaction-system test -- \
  --testNamePattern="SyncDelegatingManifestMutationAdapter"
```

**Expected Result**: 5/5 tests passing
**Location**: `packages/transaction-system/__tests__/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.test.ts`
**Test File**: `sync-delegating-manifest-mutation.adapter.test.ts`

**Verification**:

- [ ] All 5 tests pass
- [ ] No test skips or pending tests
- [ ] Execution time < 30 seconds
- [ ] Coverage report generated (if applicable)

**Tests to Pass**:

1. [ ] Should delegate manifest mutations to sync system
2. [ ] Should respect transaction boundaries
3. [ ] Should handle rollback scenarios
4. [ ] Should preserve mutation ordering
5. [ ] Should validate delegation metadata

#### ☐ 4. AI Pipeline Tests (7 tests)

```bash
yarn workspace @hexagen/ai-pipeline test -- \
  --testNamePattern="NLToDomainCommandAdapter"
```

**Expected Result**: 7/7 tests passing
**Location**: `packages/ai-pipeline/src/__tests__/adapters/nl-to-domain-command.adapter.test.ts`
**Test File**: `nl-to-domain-command.adapter.test.ts`

**Verification**:

- [ ] All 7 tests pass
- [ ] No test skips or pending tests
- [ ] Execution time < 30 seconds
- [ ] Coverage report generated (if applicable)

**Tests to Pass**:

1. [ ] Should parse simple domain commands from NL input
2. [ ] Should handle complex multi-step intents
3. [ ] Should map NL entities to domain entities
4. [ ] Should validate command preconditions
5. [ ] Should generate appropriate error messages for invalid input
6. [ ] Should preserve command context across conversions
7. [ ] Should handle edge cases and malformed input

#### ☐ 5. Total Test Count Verification

**Total Phase A Tests**: 18 (6 + 5 + 7)

**Verification**:

- [ ] Sum of all test results = 18
- [ ] All tests reported as PASSED (not SKIPPED or PENDING)
- [ ] No test timeouts
- [ ] Deterministic results (repeat runs produce same results)

---

### ARCHITECTURE & BUILD VERIFICATION

#### ☐ 6. manifest.yaml Validation

```bash
# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('.architecture/manifest.yaml'))" && echo "✓ Valid"

# Validate through linter
yarn lint:arch
```

**Expected Result**: Valid YAML, architecture compliant
**Location**: `.architecture/manifest.yaml`

**Verification**:

- [ ] YAML syntax is valid
- [ ] No parser errors
- [ ] All Phase A adapters included
- [ ] `yarn lint:arch` exits with code 0
- [ ] No architecture violations reported

---

#### ☐ 7. Lint Errors Check (Per Package)

**Reconciliation Engine**:

```bash
yarn workspace @hexagen/reconciliation-engine run lint
```

- [ ] No errors (exit code 0)
- [ ] No warnings in modified adapter
- [ ] File: `packages/reconciliation-engine/src/infrastructure/adapters/manifest-patch.adapter.ts`

**Transaction System**:

```bash
yarn workspace @hexagen/transaction-system run lint
```

- [ ] No errors (exit code 0)
- [ ] No warnings in modified adapter
- [ ] File: `packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts`

**AI Pipeline**:

```bash
yarn workspace @hexagen/ai-pipeline run lint
```

- [ ] No errors (exit code 0)
- [ ] No warnings in modified adapter
- [ ] File: `packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts`

---

#### ☐ 8. TypeCheck Verification (Phase A Packages Only)

**Note**: Web app pre-existing errors are excluded. Only check Phase A packages.

```bash
yarn workspace @hexagen/reconciliation-engine run typecheck
yarn workspace @hexagen/transaction-system run typecheck
yarn workspace @hexagen/ai-pipeline run typecheck
```

**Verification**:

- [ ] reconciliation-engine: No type errors (exit code 0)
- [ ] transaction-system: No type errors (exit code 0)
- [ ] ai-pipeline: No type errors (exit code 0)
- [ ] All new adapter classes properly typed
- [ ] Import statements resolve correctly

---

#### ☐ 9. Full Monorepo Build Verification

```bash
yarn build
```

**Expected Result**: Build succeeds, all artifacts generated
**Time Limit**: 15 minutes
**Blocking**: YES

**Verification**:

- [ ] Build completes with exit code 0
- [ ] No build errors in any package
- [ ] All dist/ directories generated correctly
- [ ] Source maps created (if applicable)
- [ ] No circular dependency warnings

---

### DEPENDENCY VERIFICATION

#### ☐ 10. Cross-Package Dependency Check

```bash
# Run dependency verification (reference: docs/phase-a-dependency-check.md)
bash scripts/phase-a-verification.sh  # Already covers this
```

**Verification**:

- [ ] No circular dependencies detected
- [ ] All barrel exports include Phase A adapters
- [ ] ESM extensions (.js) consistent
- [ ] Index.ts exports match manifest declarations
- [ ] Package.json dependencies properly declared
- [ ] TypeScript path resolution works correctly

---

### DOCUMENTATION VERIFICATION

#### ☐ 11. Documentation Completeness

```bash
# Verify all required documentation exists
test -f docs/phase-8-remediation-integration-tests.md && echo "✓"
test -f docs/phase-a-dependency-check.md && echo "✓"
test -f docs/phase-b-preconditions.md && echo "✓"
test -f docs/phase-a-rollback-procedure.md && echo "✓"
test -f scripts/phase-a-verification.sh && echo "✓"
```

**Verification**:

- [ ] `docs/phase-8-remediation-integration-tests.md` exists
- [ ] `docs/phase-a-dependency-check.md` exists
- [ ] `docs/phase-b-preconditions.md` exists
- [ ] `docs/phase-a-rollback-procedure.md` exists
- [ ] `scripts/phase-a-verification.sh` exists and is executable

---

### FINAL SIGN-OFF

#### ☐ 12. Ready for Phase B

**Review Checklist**:

- [ ] All checkboxes above are marked complete
- [ ] All verification steps passed
- [ ] No blocking issues remain
- [ ] Code review completed (if required)
- [ ] Integration tests documented and understood
- [ ] Rollback procedure understood by team
- [ ] Next phase requirements reviewed

**Sign-Off**:

- [ ] Code Owner: **\*\*\*\***\_**\*\*\*\*** (Signature)
- [ ] QA Verification: **\*\*\*\***\_**\*\*\*\*** (Signature)
- [ ] Date: **\*\*\*\***\_**\*\*\*\***

**Approval Statement**:

> I confirm that Phase A verification is complete and all preconditions for Phase B are satisfied.

---

## Preconditions Met → Phase B Can Begin

Once all items are checked, Phase B can begin with:

```bash
delegate phase-b
```

or

```bash
develop phase-8-remediation-b
```

---

## Failure Recovery

If any precondition fails:

1. **Identify**: Which precondition failed?
2. **Root Cause**: What is the underlying issue?
3. **Remediate**: Fix the issue in the code
4. **Re-verify**: Run the failing check again
5. **Document**: Record the issue and resolution in PR notes
6. **Retry**: Run `scripts/phase-a-verification.sh` again

### Common Failures

| Failure          | Resolution                  | Time Est. |
| ---------------- | --------------------------- | --------- |
| Test fails       | Debug test, fix adapter     | 15-30 min |
| Build error      | Fix compilation errors      | 5-15 min  |
| Lint error       | Run formatter, fix rules    | 5-10 min  |
| Type error       | Add proper type annotations | 10-20 min |
| Dependency issue | Update manifest.yaml        | 5-10 min  |

---

## Phase A → Phase B Transition

**When Phase A is complete:**

1. All preconditions marked ✓
2. All gates passing
3. All 18 tests passing
4. Build and typecheck succeeding
5. Documentation complete

**Then Phase B begins** with implementation of:

- Export pipeline integration
- Mutation boundary enforcement
- Cross-adapter communication patterns

---

## Next Steps After Phase B Approval

- [ ] Tag Phase A completion in git (optional)
- [ ] Review Phase B requirements
- [ ] Plan Phase B timeline
- [ ] Assign Phase B owners
- [ ] Begin Phase B work
