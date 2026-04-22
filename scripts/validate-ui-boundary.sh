#!/usr/bin/env bash
# scripts/validate-ui-boundary.sh
#
# Layer 3 of the 3-layer information state firewall.
# Reads its blocklist from scripts/firewall-blocklist.yaml (single source
# shared with Layer 2 ESLint rules).
#
# Scope: packages/ui/src + apps/web/{app,features}
#
# Usage: Run in CI as part of the merge gate.
# Exit code: 0 if compliant, 1 if any violations found.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BLOCKLIST="$SCRIPT_DIR/firewall-blocklist.yaml"
UI_SRC="$ROOT_DIR/packages/ui/src"
WEB_APP="$ROOT_DIR/apps/web/app"
WEB_FEATURES="$ROOT_DIR/apps/web/features"

if ! command -v yq &>/dev/null; then
  echo "⚠️  yq not found — using fallback grep-based parsing"
  parse_yaml_list() {
    local key="$1"
    grep -A 100 "^${key}:" "$BLOCKLIST" | grep '^\s*- "' | sed 's/.*"\([^"]*\)".*/\1/'
  }
else
  parse_yaml_list() {
    local key="$1"
    yq ".${key}[]" "$BLOCKLIST"
  }
fi

echo "🛡️  UI Boundary Validation (Layer 3 — CI Structural Check)"
echo "============================================================"

VIOLATIONS=0

# Check 1: No kernel package imports in UI
echo ""
echo "Checking for forbidden kernel imports in packages/ui..."
while IFS= read -r pkg; do
  if grep -rq "from ['\"]${pkg}" "$UI_SRC" 2>/dev/null; then
    echo "  ❌ Found import from forbidden kernel package: $pkg"
    grep -rn "from ['\"]${pkg}" "$UI_SRC" 2>/dev/null | while read -r line; do
      echo "     → $line"
    done
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(parse_yaml_list "kernel_packages")

# Check 2: No feature slice imports in UI
echo ""
echo "Checking for feature slice imports in packages/ui..."
if grep -rqE "(from ['\"].*features/|import.*from.*features)" "$UI_SRC" 2>/dev/null; then
  echo "  ❌ Found import from feature slice"
  grep -rnE "(from ['\"].*features/|import.*from.*features)" "$UI_SRC" 2>/dev/null | while read -r line; do
    echo "     → $line"
  done
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# Check 3: No semantic state tokens in UI prop definitions (ERROR, not warning)
echo ""
echo "Checking for semantic state tokens in UI source..."
while IFS= read -r token; do
  if grep -rqE "(interface|type).*\\b${token}\\b" "$UI_SRC" 2>/dev/null; then
    echo "  ❌ Found forbidden token '${token}' in type/interface definition"
    grep -rnE "(interface|type).*\\b${token}\\b" "$UI_SRC" 2>/dev/null | while read -r line; do
      echo "     → $line"
    done
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(parse_yaml_list "forbidden_prop_names")

# Check 4: No @hexagen/* imports except allowed ones in UI
echo ""
echo "Checking @hexagen/* import whitelist in packages/ui..."
while IFS= read -r file; do
  while IFS= read -r import_line; do
    pkg=$(echo "$import_line" | grep -oE "@hexagen/[a-z-]+" | head -1)
    allowed=false
    while IFS= read -r allowed_pkg; do
      if [ "$pkg" = "$allowed_pkg" ]; then
        allowed=true
        break
      fi
    done < <(parse_yaml_list "allowed_hexagen_imports")
    if [ "$allowed" = false ]; then
      echo "  ❌ Forbidden @hexagen/* import in UI: $pkg"
      echo "     → $file: $import_line"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < <(grep -E "from ['\"]@hexagen/" "$file" 2>/dev/null || true)
done < <(grep -rlE "from ['\"]@hexagen/" "$UI_SRC" 2>/dev/null || true)

# Check 5: No runtime LLMMessage/LocalLLMProviderPort imports in apps/web
echo ""
echo "Checking for runtime @internal ACL type imports in apps/web..."
while IFS= read -r internal_type; do
  for dir in "$WEB_APP" "$WEB_FEATURES"; do
    if [ -d "$dir" ]; then
      while IFS= read -r file; do
        if grep -qE "import\s+\{[^}]*\b${internal_type}\b" "$file" 2>/dev/null; then
          echo "  ❌ Found runtime import of @internal type '${internal_type}' in: $file"
          grep -nE "import\s+\{[^}]*\b${internal_type}\b" "$file" 2>/dev/null | while read -r line; do
            echo "     → $line"
          done
          VIOLATIONS=$((VIOLATIONS + 1))
        fi
      done < <(find "$dir" -name '*.ts' -o -name '*.tsx' 2>/dev/null || true)
    fi
  done
done < <(parse_yaml_list "acl_internal_types")

# Check 6: No cross-slice imports (workspace-shell exempted)
echo ""
echo "Checking for cross-slice imports in features/..."
if [ -d "$WEB_FEATURES" ]; then
  for slice_dir in "$WEB_FEATURES"/*/; do
    slice_name=$(basename "$slice_dir")
    [ "$slice_name" = "workspace-shell" ] && continue
    while IFS= read -r file; do
      while IFS= read -r import_line; do
        target=$(echo "$import_line" | grep -oE '\.\./([^/]+)' | head -1 | sed 's/\.\.\///')
        if [ -n "$target" ] && [ "$target" != "$slice_name" ] && [ -d "$WEB_FEATURES/$target" ]; then
          echo "  ❌ Cross-slice import: $slice_name → $target"
          echo "     → $file: $import_line"
          VIOLATIONS=$((VIOLATIONS + 1))
        fi
      done < <(grep -E 'from "\.\./' "$file" 2>/dev/null || true)
    done < <(find "$slice_dir" -name '*.ts' -o -name '*.tsx' 2>/dev/null || true)
  done
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
