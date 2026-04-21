#!/usr/bin/env bash
# scripts/validate-ui-boundary.sh
#
# Layer 3 of the 3-layer information state firewall for @hexagen/ui.
# Performs structural dependency analysis to catch bypass attempts
# that Layers 1 (TypeScript brands) and 2 (ESLint rules) might miss.
#
# Usage: Run in CI as part of the merge gate.
# Exit code: 0 if compliant, 1 if any violations found.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
UI_SRC="$ROOT_DIR/packages/ui/src"

echo "🛡️  UI Boundary Validation (Layer 3 — CI Structural Check)"
echo "============================================================"

VIOLATIONS=0

# Check 1: No kernel package imports
echo ""
echo "Checking for forbidden kernel imports..."
KERNEL_PKGS=(
  "@hexagen/core-domain"
  "@hexagen/architectural-enforcement"
  "@hexagen/intent-compiler"
  "@hexagen/transaction-system"
  "@hexagen/prompt-compiler"
  "@hexagen/reconciliation-engine"
  "@hexagen/runtime"
)

for pkg in "${KERNEL_PKGS[@]}"; do
  if grep -rq "from ['\"]${pkg}" "$UI_SRC" 2>/dev/null; then
    echo "  ❌ Found import from forbidden kernel package: $pkg"
    grep -rn "from ['\"]${pkg}" "$UI_SRC" 2>/dev/null | while read -r line; do
      echo "     → $line"
    done
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

# Check 2: No feature slice imports
echo ""
echo "Checking for feature slice imports..."
if grep -rqE "(from ['\"].*features/|import.*from.*features)" "$UI_SRC" 2>/dev/null; then
  echo "  ❌ Found import from feature slice"
  grep -rnE "(from ['\"].*features/|import.*from.*features)" "$UI_SRC" 2>/dev/null | while read -r line; do
    echo "     → $line"
  done
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# Check 3: No semantic state tokens in prop definitions
echo ""
echo "Checking for semantic state tokens in UI source..."
FORBIDDEN_TOKENS="data\b|loading\b|error\b|result\b|isFetching|isPending|isSuccess|isError"
if grep -rqE "(interface|type).*(data|loading|error|result|isFetching|isPending|isSuccess|isError)" "$UI_SRC" 2>/dev/null; then
  echo "  ⚠️  Found potential semantic state token in type/interface definition"
  grep -rnE "(interface|type).*(data|loading|error|result|isFetching|isPending|isSuccess|isError)" "$UI_SRC" 2>/dev/null | while read -r line; do
    echo "     → $line"
  done
  # Warning only — some legitimate props may contain these words
fi

# Check 4: No @hexagen/* imports except allowed ones
echo ""
echo "Checking @hexagen/* import whitelist..."
ALLOWED_HEXAGEN="@(hexagen/ui|hexagen/shared)"
if grep -rqE "from ['\"]@hexagen/" "$UI_SRC" 2>/dev/null; then
  while IFS= read -r file; do
    while IFS= read -r import_line; do
      pkg=$(echo "$import_line" | grep -oE "@hexagen/[a-z-]+" | head -1)
      case "$pkg" in
        "@hexagen/ui"|"@hexagen/shared")
          # Allowed
          ;;
        *)
          echo "  ❌ Forbidden @hexagen/* import in UI: $pkg"
          echo "     → $file: $import_line"
          VIOLATIONS=$((VIOLATIONS + 1))
          ;;
      esac
    done < <(grep -E "from ['\"]@hexagen/" "$file" 2>/dev/null || true)
  done < <(grep -rlE "from ['\"]@hexagen/" "$UI_SRC" 2>/dev/null || true)
fi

echo ""
echo "============================================================"
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "❌ UI Boundary Check FAILED — $VIOLATIONS violation(s) found"
  exit 1
else
  echo "✅ UI Boundary Check PASSED — no violations found"
  exit 0
fi
