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
  echo "⚠️  yq not found — using fallback awk-based parsing"
  # Block-scoped: emit list items only until the next top-level key. The
  # previous `grep -A 100 "^${key}:"` had no terminator, so on a runner without
  # yq EVERY key returned EVERY list item in the file — kernel_packages would
  # have included "status"/"data" and allowed_hexagen_imports would have
  # included "@hexagen/core-domain". The two parsers must agree or the gate
  # means something different depending on which host it runs on.
  parse_yaml_list() {
    local key="$1"
    awk -v key="$key" '
      $0 ~ "^" key ":[[:space:]]*$" { inblock = 1; next }
      inblock && /^[^[:space:]#]/   { inblock = 0 }
      inblock && /^[[:space:]]*-[[:space:]]*"/ {
        sub(/^[^"]*"/, ""); sub(/".*$/, ""); print
      }
    ' "$BLOCKLIST"
  }
else
  parse_yaml_list() {
    local key="$1"
    yq ".${key}[]" "$BLOCKLIST"
  }
fi

# Every check below feeds its loop from `parse_yaml_list` through a process
# substitution — and a command that dies inside `< <(...)` does NOT fail the
# script even under `set -e`. So a broken blocklist parse (missing key, wrong
# yq flavour, renamed section) would drain an empty list, skip the loop body
# and print "PASSED" while checking nothing. Assert up front that every key
# the checks depend on yields at least one entry, so a parse failure is loud.
assert_blocklist_key() {
  local key="$1"
  local count
  count="$(parse_yaml_list "$key" | grep -c . || true)"
  if [ "$count" -eq 0 ]; then
    echo "❌ Blocklist parse failure: '${key}' produced no entries from ${BLOCKLIST}."
    echo "   Refusing to report compliance on an empty rule set."
    exit 2
  fi
}

for _key in kernel_packages forbidden_prop_names allowed_hexagen_imports acl_internal_types; do
  assert_blocklist_key "$_key"
done

# Lexically normalise a path: collapse "." and ".." segments without touching
# the filesystem (import specifiers have no extension, so `realpath` can't be
# used). Emits an absolute path.
normalize_path() {
  local input="$1"
  local -a out=()
  local -a parts=()
  local seg
  local saved_ifs="$IFS"
  IFS='/'
  read -ra parts <<< "$input"
  IFS="$saved_ifs"
  for seg in "${parts[@]}"; do
    case "$seg" in
      '' | '.') ;;
      '..')
        if [ "${#out[@]}" -gt 0 ]; then
          unset 'out[${#out[@]}-1]'
          out=("${out[@]}")
        fi
        ;;
      *) out+=("$seg") ;;
    esac
  done
  local joined=""
  saved_ifs="$IFS"
  IFS='/'
  joined="${out[*]-}"
  IFS="$saved_ifs"
  printf '/%s' "$joined"
}

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

# Check 6: No cross-slice imports (workspace-shell exempted, both directions)
#
# The specifier is resolved LEXICALLY against the importing file's directory
# and only counts as a violation when it lands inside a *different* slice under
# features/. The previous implementation took the first `../<segment>` match as
# the target, so `../../app/lib/wire` yielded the literal target ".." — and
# `[ -d "$WEB_FEATURES/.." ]` is apps/web, which always exists. That reported
# every escape-the-slice import (including same-slice `../../<own-dir>/x` hops
# from a nested `__tests__/` folder) as a cross-slice violation: 62 false
# positives against a real count of 3.
#
# workspace-shell is the composition shell: it mounts the slices, and it owns
# the lifecycle contexts (WizardLifecycleContext) the slices consume. It was
# already exempt as an import SOURCE; the exemption is symmetric here because
# a slice reading the shell's context is the shell/slice composition seam, not
# a peer-to-peer coupling. Slice→slice imports remain violations.
SHELL_SLICE="workspace-shell"

echo ""
echo "Checking for cross-slice imports in features/..."
if [ -d "$WEB_FEATURES" ]; then
  FEATURES_ROOT="$(normalize_path "$WEB_FEATURES")"
  for slice_dir in "$WEB_FEATURES"/*/; do
    slice_name=$(basename "$slice_dir")
    [ "$slice_name" = "$SHELL_SLICE" ] && continue
    while IFS= read -r file; do
      file_dir=$(dirname "$file")
      while IFS= read -r specifier; do
        resolved="$(normalize_path "${file_dir}/${specifier}")"
        case "$resolved" in
          "$FEATURES_ROOT"/*) ;;
          *) continue ;;
        esac
        rest="${resolved#"$FEATURES_ROOT"/}"
        target="${rest%%/*}"
        [ "$target" = "$slice_name" ] && continue
        [ "$target" = "$SHELL_SLICE" ] && continue
        echo "  ❌ Cross-slice import: $slice_name → $target"
        echo "     → $file: $specifier"
        VIOLATIONS=$((VIOLATIONS + 1))
      done < <(grep -ohE "from ['\"]\.\.?/[^'\"]*['\"]" "$file" 2>/dev/null |
        sed -E "s/^from ['\"](.*)['\"]$/\1/" || true)
    done < <(find "$slice_dir" \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null || true)
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
