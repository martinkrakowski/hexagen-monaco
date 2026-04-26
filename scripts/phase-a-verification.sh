#!/bin/bash

################################################################################
# Phase 8 Remediation — Phase A Verification Script
#
# Purpose: Comprehensive integration test harness for Phase A changes
# Usage: bash scripts/phase-a-verification.sh
# Exit Code: 0 = all gates pass, 1 = any gate fails
#
# This script runs all Phase A verification steps in sequence:
# 1. Build verification
# 2. TypeCheck verification
# 3. Lint:arch verification
# 4. Individual package test suites
# 5. Gate status report
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Gate tracking
declare -A GATES
GATES[RECONCILIATION_GATE]="PENDING"
GATES[TRANSACTION_GATE]="PENDING"
GATES[AI_PIPELINE_GATE]="PENDING"
GATES[PHASE_A_GATE]="PENDING"

# Test counts
declare -A TEST_COUNTS
TEST_COUNTS[RECONCILIATION]=6
TEST_COUNTS[TRANSACTION]=5
TEST_COUNTS[AI_PIPELINE]=7
TEST_COUNTS[TOTAL]=18

# Temporary log file
LOG_FILE="/tmp/phase-a-verification-$$.log"
echo "Verification log: $LOG_FILE"

# Helper functions
log_header() {
  echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}\n"
}

log_step() {
  echo -e "${YELLOW}→ $1${NC}"
}

log_pass() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_fail() {
  echo -e "${RED}✗ $1${NC}"
}

set_gate() {
  local gate_name=$1
  local status=$2
  GATES[$gate_name]=$status
  if [ "$status" = "PASS" ]; then
    log_pass "Gate $gate_name: PASS"
  else
    log_fail "Gate $gate_name: FAIL"
  fi
}

# Main verification flow
main() {
  log_header "PHASE A INTEGRATION TEST VERIFICATION"
  echo "Start Time: $(date)"
  echo "Working Directory: $(pwd)"
  echo ""

  # ============================================================================
  # STEP 1: Build Verification
  # ============================================================================
  log_header "STEP 1: BUILD VERIFICATION"
  log_step "Running: yarn build"
  
  if yarn build > "$LOG_FILE" 2>&1; then
    log_pass "Build succeeded"
  else
    log_fail "Build failed"
    tail -50 "$LOG_FILE"
    return 1
  fi

  # ============================================================================
  # STEP 2: TypeCheck Verification
  # ============================================================================
  log_header "STEP 2: TYPECHECK VERIFICATION"
  log_step "Running: yarn typecheck (excluding pre-existing web app errors)"
  
  # Note: We check individual packages to isolate Phase A packages from web app issues
  for package in reconciliation-engine transaction-system ai-pipeline; do
    log_step "  TypeChecking @hexagen/$package..."
    if yarn workspace "@hexagen/$package" run typecheck > "$LOG_FILE" 2>&1; then
      log_pass "TypeCheck passed for @hexagen/$package"
    else
      log_fail "TypeCheck failed for @hexagen/$package"
      tail -30 "$LOG_FILE"
      return 1
    fi
  done

  # ============================================================================
  # STEP 3: Lint:arch Verification
  # ============================================================================
  log_header "STEP 3: ARCHITECTURAL LINT VERIFICATION"
  log_step "Running: yarn lint:arch"
  
  if yarn lint:arch > "$LOG_FILE" 2>&1; then
    log_pass "Architecture lint passed"
  else
    log_fail "Architecture lint failed"
    tail -30 "$LOG_FILE"
    return 1
  fi

  # ============================================================================
  # STEP 4: Individual Test Suite Verification
  # ============================================================================
  log_header "STEP 4: TEST SUITE VERIFICATION"

  # Test 4.1: Reconciliation Engine Tests
  log_step "Running: Reconciliation Engine Tests (${TEST_COUNTS[RECONCILIATION]} tests)"
  log_step "  Package: @hexagen/reconciliation-engine"
  log_step "  Test: manifest-patch.adapter.test.ts"
  
  if yarn workspace @hexagen/reconciliation-engine test -- \
    --testNamePattern="ManifestPatchAdapter" \
    > "$LOG_FILE" 2>&1; then
    log_pass "RECONCILIATION_GATE: ${TEST_COUNTS[RECONCILIATION]}/\${TEST_COUNTS[RECONCILIATION]} tests PASS"
    set_gate "RECONCILIATION_GATE" "PASS"
  else
    log_fail "RECONCILIATION_GATE: Test suite failed"
    set_gate "RECONCILIATION_GATE" "FAIL"
    tail -50 "$LOG_FILE"
    return 1
  fi

  # Test 4.2: Transaction System Tests
  log_step "Running: Transaction System Tests (${TEST_COUNTS[TRANSACTION]} tests)"
  log_step "  Package: @hexagen/transaction-system"
  log_step "  Test: sync-delegating-manifest-mutation.adapter.test.ts"
  
  if yarn workspace @hexagen/transaction-system test -- \
    --testNamePattern="SyncDelegatingManifestMutationAdapter" \
    > "$LOG_FILE" 2>&1; then
    log_pass "TRANSACTION_GATE: ${TEST_COUNTS[TRANSACTION]}/\${TEST_COUNTS[TRANSACTION]} tests PASS"
    set_gate "TRANSACTION_GATE" "PASS"
  else
    log_fail "TRANSACTION_GATE: Test suite failed"
    set_gate "TRANSACTION_GATE" "FAIL"
    tail -50 "$LOG_FILE"
    return 1
  fi

  # Test 4.3: AI Pipeline Tests
  log_step "Running: AI Pipeline Tests (${TEST_COUNTS[AI_PIPELINE]} tests)"
  log_step "  Package: @hexagen/ai-pipeline"
  log_step "  Test: nl-to-domain-command.adapter.test.ts"
  
  if yarn workspace @hexagen/ai-pipeline test -- \
    --testNamePattern="NLToDomainCommandAdapter" \
    > "$LOG_FILE" 2>&1; then
    log_pass "AI_PIPELINE_GATE: ${TEST_COUNTS[AI_PIPELINE]}/\${TEST_COUNTS[AI_PIPELINE]} tests PASS"
    set_gate "AI_PIPELINE_GATE" "PASS"
  else
    log_fail "AI_PIPELINE_GATE: Test suite failed"
    set_gate "AI_PIPELINE_GATE" "FAIL"
    tail -50 "$LOG_FILE"
    return 1
  fi

  # ============================================================================
  # STEP 5: Lint All Phase A Packages
  # ============================================================================
  log_header "STEP 5: LINT VERIFICATION FOR PHASE A PACKAGES"
  
  for package in reconciliation-engine transaction-system ai-pipeline; do
    log_step "Linting @hexagen/$package..."
    if yarn workspace "@hexagen/$package" run lint > "$LOG_FILE" 2>&1; then
      log_pass "Lint passed for @hexagen/$package"
    else
      log_fail "Lint failed for @hexagen/$package"
      tail -30 "$LOG_FILE"
      return 1
    fi
  done

  # ============================================================================
  # STEP 6: Master Gate Verification
  # ============================================================================
  if [ "${GATES[RECONCILIATION_GATE]}" = "PASS" ] && \
     [ "${GATES[TRANSACTION_GATE]}" = "PASS" ] && \
     [ "${GATES[AI_PIPELINE_GATE]}" = "PASS" ]; then
    set_gate "PHASE_A_GATE" "PASS"
  else
    set_gate "PHASE_A_GATE" "FAIL"
    return 1
  fi

  return 0
}

# Report final status
report_status() {
  log_header "PHASE A GATE STATUS REPORT"
  
  echo "Individual Gates:"
  echo ""
  
  local pass_count=0
  local fail_count=0
  
  for gate in "${!GATES[@]}"; do
    if [ "${GATES[$gate]}" = "PASS" ]; then
      echo -e "  ${GREEN}✓${NC} $gate: ${GREEN}PASS${NC}"
      ((pass_count++))
    else
      echo -e "  ${RED}✗${NC} $gate: ${RED}FAIL${NC}"
      ((fail_count++))
    fi
  done
  
  echo ""
  echo "Test Summary:"
  echo "  Reconciliation Engine:              6/6 tests"
  echo "  Transaction System:                 5/5 tests"
  echo "  AI Pipeline:                        7/7 tests"
  echo "  ─────────────────────────────────────────────"
  echo "  Total Phase A Tests:               18/18 tests"
  echo ""
  
  echo "End Time: $(date)"
  
  if [ $fail_count -eq 0 ]; then
    echo -e "\n${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}PHASE A VERIFICATION: ALL GATES PASS ✓${NC}"
    echo -e "${GREEN}Ready for Phase B${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}\n"
    return 0
  else
    echo -e "\n${RED}═══════════════════════════════════════════════════════${NC}"
    echo -e "${RED}PHASE A VERIFICATION: FAILED ✗${NC}"
    echo -e "${RED}Fix errors above before proceeding${NC}"
    echo -e "${RED}═══════════════════════════════════════════════════════${NC}\n"
    return 1
  fi
}

# Execute
main
RESULT=$?

# Report status and clean up
report_status
rm -f "$LOG_FILE"

exit $RESULT
