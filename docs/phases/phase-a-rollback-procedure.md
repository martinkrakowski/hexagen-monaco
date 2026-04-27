# Phase A Rollback Procedure

## Overview

This document defines the step-by-step process to rollback Phase A changes if critical issues are discovered after commit. Rollback should only be used if a fatal issue prevents Phase B from proceeding.

---

## Rollback Decision Criteria

**Initiate rollback if ANY of the following are TRUE:**

- [ ] Critical test failures (>3 tests failing across Phase A)
- [ ] Circular dependency loop introduced
- [ ] Build fails in dependent packages (Phase B or beyond)
- [ ] manifest.yaml becomes corrupted
- [ ] Unrecoverable type errors in Phase A adapters
- [ ] Architectural invariant violations (per lint:arch)
- [ ] Integration test suite cannot be fixed within 2 hours
- [ ] Phase A changes break existing functionality in other packages

**Do NOT rollback for:**

- ✓ Minor test failures (1-2 tests) — fix directly
- ✓ Lint warnings — fix and amend commit
- ✓ Code style issues — run formatter
- ✓ Documentation gaps — update docs only

---

## Pre-Rollback Checklist

Before initiating rollback:

- [ ] Have you confirmed the issue cannot be fixed without rollback?
- [ ] Has the team been notified of the rollback decision?
- [ ] Do you have write access to the repository?
- [ ] Is your git working directory clean (no uncommitted changes)?
- [ ] Have you backed up any debug logs needed for post-mortem?

---

## Rollback Process

### Phase 1: Pre-Rollback Assessment

#### Step 1.1: Document Current State

```bash
# Capture current state before rollback
git log --oneline -5 > /tmp/phase-a-rollback-log.txt
git status >> /tmp/phase-a-rollback-log.txt
date >> /tmp/phase-a-rollback-log.txt

echo "Current state saved to /tmp/phase-a-rollback-log.txt"
```

#### Step 1.2: Identify Phase A Commits

```bash
# Find the Phase A commits
git log --oneline --all | grep -i "phase.*a\|remediation.*a\|adapter" | head -5

# Example output:
# d73fa34 fix: Phase 8a — Add LinerReport-driven filtering to reconciliation engine + test fixes
# 3237f47 Phase 2b: Complete NL-to-DomainCommand parser with tests and adapter fixes
```

#### Step 1.3: Identify Phase A Start Point

```bash
# Find the commit BEFORE Phase A started
git log --oneline --all | head -20

# Determine: What is the last "good" commit before Phase A?
# This will be your ROLLBACK_TARGET
```

---

### Phase 2: Git Rollback

#### Step 2.1: Create Rollback Branch (SAFE)

```bash
# Never rollback main/master directly
# Instead, create a rollback branch for review

git checkout -b rollback/phase-a-$(date +%Y%m%d-%H%M%S)
```

#### Step 2.2: Identify Rollback Target

**Option A: Soft Rollback (Keep Changes, Unstage Commits)**

```bash
# If Phase A is NOT yet committed to main
git reset --soft <COMMIT_BEFORE_PHASE_A>
# Changes remain in working directory
# Use: yarn build && yarn test to verify
```

**Option B: Hard Rollback (Delete All Phase A Changes)**

```bash
# If Phase A IS committed to main
# Find the commit just before Phase A
ROLLBACK_TARGET="<commit_hash_before_phase_a>"

git reset --hard $ROLLBACK_TARGET
echo "Hard reset to: $ROLLBACK_TARGET"

# Verify the reset
git log --oneline -3
```

#### Step 2.3: Verify Rollback

```bash
# Build to confirm rollback worked
yarn build

# If build fails, rollback failed — investigate
# If build succeeds, continue
```

---

### Phase 3: File-Level Rollback (If Selective Rollback Needed)

**Use this if only specific Phase A files need rollback, not all.**

#### Step 3.1: List Phase A Modified Files

```bash
# Identify files changed by Phase A
git diff --name-only <COMMIT_BEFORE_PHASE_A>..HEAD | grep -E "reconciliation-engine|transaction-system|ai-pipeline|manifest-patch|sync-delegating|nl-to-domain"

# Example:
# packages/reconciliation-engine/src/infrastructure/adapters/manifest-patch.adapter.ts
# packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts
# packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts
# ...etc
```

#### Step 3.2: Revert Specific Files

```bash
# Option 1: Revert to previous version
git checkout <COMMIT_BEFORE_PHASE_A> -- packages/reconciliation-engine/src/infrastructure/adapters/manifest-patch.adapter.ts

# Option 2: Delete new files entirely
git rm packages/reconciliation-engine/src/__tests__/manifest-patch.adapter.test.ts

# Option 3: Restore file from specific commit
git show <COMMIT_BEFORE_PHASE_A>:packages/transaction-system/src/infrastructure/adapters/index.ts > packages/transaction-system/src/infrastructure/adapters/index.ts
```

#### Step 3.3: Update Barrel Files

Remove Phase A adapter exports from barrel files:

```bash
# reconciliation-engine/src/infrastructure/adapters/index.ts
# Remove: export * from "./manifest-patch.adapter.js";

# transaction-system/src/infrastructure/adapters/index.ts
# Remove: export * from "./sync-delegating-manifest-mutation.adapter.js";

# ai-pipeline/src/infrastructure/adapters/index.ts
# Remove: export * from "./nl-to-domain-command.adapter.js";
```

Use your editor or sed:

```bash
sed -i '' '/manifest-patch/d' packages/reconciliation-engine/src/infrastructure/adapters/index.ts
sed -i '' '/sync-delegating/d' packages/transaction-system/src/infrastructure/adapters/index.ts
sed -i '' '/nl-to-domain-command/d' packages/ai-pipeline/src/infrastructure/adapters/index.ts
```

#### Step 3.4: Verify Partial Rollback

```bash
yarn build && yarn typecheck && yarn lint:arch
```

---

### Phase 4: Manifest.yaml Rollback

#### Step 4.1: Restore Previous manifest.yaml

```bash
# Get previous manifest version
git show <COMMIT_BEFORE_PHASE_A>:.architecture/manifest.yaml > .architecture/manifest.yaml.backup

# Restore
git checkout <COMMIT_BEFORE_PHASE_A> -- .architecture/manifest.yaml
```

#### Step 4.2: Verify Manifest Validity

```bash
# Validate restored manifest
python3 -c "import yaml; yaml.safe_load(open('.architecture/manifest.yaml'))" && echo "✓ Manifest valid"

# Run linter
yarn lint:arch
```

---

### Phase 5: Full Build Verification

#### Step 5.1: Clean Build Environment

```bash
# Remove cache and dist
rm -rf packages/*/dist .turbo node_modules/.cache
find . -name "*.tsbuildinfo" -delete
```

#### Step 5.2: Fresh Build

```bash
# Full rebuild without cache
yarn build

# Full typecheck
yarn typecheck

# Lint architecture
yarn lint:arch

# Run tests (critical tests only)
yarn test
```

#### Step 5.3: Verify No Errors

```bash
# Expected output:
# ✓ All builds succeed
# ✓ No type errors in packages (excluding pre-existing web app issues)
# ✓ Architecture compliant
# ✓ All existing tests pass
```

---

### Phase 6: Git History Cleanup

**ONLY after verification succeeds:**

#### Step 6.1: Option A — Revert Commits (Preferred)

```bash
# Create a revert commit instead of rewriting history
# This is safer and preserves git history

git revert --no-edit <COMMIT_HASH_OF_PHASE_A>

# This creates a new commit that undoes Phase A
# Push this revert commit to main
```

#### Step 6.2: Option B — Force Reset (Use with Caution)

```bash
# ONLY if no one has pulled Phase A commits yet

git reset --hard <COMMIT_BEFORE_PHASE_A>

# Verify rollback
git log --oneline -3

# Force push to main (⚠️ Destructive!)
git push origin main --force

# NOTIFY TEAM: Do not pull until acknowledged
```

---

## Post-Rollback Steps

### Step 7.1: Notify Team

```
🚨 PHASE A ROLLBACK IN PROGRESS 🚨

Reason: [Insert specific reason]
Rollback Commit: [hash]
Rollback Time: [timestamp]

All developers:
1. Do NOT pull this branch yet
2. Expected reversal: [date/time]
3. Post-mortem scheduled: [time]

Questions? #engineering-channel
```

### Step 7.2: Document Root Cause

```bash
# Create post-mortem file
cat > /tmp/phase-a-rollback-postmortem.md << 'EOF'
# Phase A Rollback Post-Mortem

## When
- Rollback Date: [date]
- Rollback Time: [time]

## Why
- Critical Issue: [description]
- Discovery: [how was it found?]
- Impact: [what was broken?]

## Root Cause
- [Technical reason]
- [Contributing factors]

## Prevention
- [What could have prevented this?]
- [Changes to QA process]
- [Changes to testing]

## Next Steps
- [ ] Fix the underlying issue
- [ ] Add regression tests
- [ ] Re-plan Phase A
- [ ] Update Phase A preconditions

EOF

cat /tmp/phase-a-rollback-postmortem.md
```

### Step 7.3: Plan Recovery

```bash
# Determine:
1. Can Phase A be fixed and re-applied?
2. Should Phase A be redesigned?
3. Are other phases blocked?
4. What is the new timeline?

# Schedule:
- Root cause analysis session
- Design review (if redesign needed)
- Updated Phase A plan
- New target date for Phase A restart
```

---

## Rollback Verification Checklist

After rollback is complete:

- [ ] Git log shows rollback commit
- [ ] manifest.yaml restored to pre-Phase A state
- [ ] All Phase A adapter files removed
- [ ] Barrel files cleaned of Phase A exports
- [ ] Build succeeds: `yarn build`
- [ ] TypeCheck passes: `yarn typecheck`
- [ ] Lint passes: `yarn lint:arch`
- [ ] All existing tests pass: `yarn test`
- [ ] No Phase A code remains in codebase
- [ ] Team notified of rollback
- [ ] Post-mortem scheduled

---

## Quick Reference: Rollback Commands

```bash
# Fastest rollback (HARD RESET):
ROLLBACK_TARGET="$(git log --oneline --all | grep -i 'before phase a' | head -1 | cut -d' ' -f1)"
git reset --hard $ROLLBACK_TARGET
yarn build && yarn typecheck
git push origin main --force

# Safest rollback (REVERT):
PHASE_A_COMMIT="<hash_of_phase_a_commit>"
git revert --no-edit $PHASE_A_COMMIT
yarn build && yarn typecheck
git push origin main

# Selective rollback (FILE-BY-FILE):
git checkout <COMMIT_BEFORE_PHASE_A> -- \
  packages/reconciliation-engine/src/infrastructure/adapters/manifest-patch.adapter.ts \
  packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts \
  packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts
yarn build && yarn typecheck
```

---

## Prevention: Avoiding Rollback

**To prevent the need for rollback:**

1. ✅ Run `scripts/phase-a-verification.sh` before committing
2. ✅ Verify all 18 tests pass
3. ✅ Run full build: `yarn build && yarn typecheck && yarn lint:arch`
4. ✅ Have peer review of all Phase A changes
5. ✅ Test in staging/pre-prod if possible
6. ✅ Document all changes clearly
7. ✅ Create PR with linked Phase A documentation

---

## Support

**If you need to rollback Phase A:**

1. Review this document carefully
2. Run rollback commands exactly as specified
3. Verify each step before proceeding
4. Contact engineering lead if issues arise
5. Document the incident for team learning

**Ask for help if:**

- ✗ Unsure which commit to rollback to
- ✗ Rollback causes new errors
- ✗ Don't understand the git commands
- ✗ Team coordination needed for push

---

## Appendix: Git Commands Reference

```bash
# Show commits between two points
git log --oneline <old_commit>..<new_commit>

# Show what changed in a commit
git show <commit_hash>

# Revert a single commit
git revert --no-edit <commit_hash>

# Revert multiple commits
git revert --no-edit <oldest_commit>^..<newest_commit>

# Undo revert
git revert --no-edit <revert_commit_hash>

# Check if rollback would work (dry run)
git diff <target_commit> <current_commit> --stat

# Show files changed by Phase A
git diff --name-only <before_phase_a>..<after_phase_a>
```

---

**Last Updated**: Phase 8 Remediation Planning
**Version**: 1.0
**Status**: Approved for Phase A Execution
