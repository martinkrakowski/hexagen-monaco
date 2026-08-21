#!/usr/bin/env bash
# scripts/validate-ui-boundary.sh
#
# Layer 3 of the 3-layer information state firewall.
# Reads its blocklist from scripts/firewall-blocklist.yaml (single source
# shared with Layer 2 ESLint rules).
#
# Scope: packages/ui/src + apps/web/{app,features,components/primitives}
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
# BF-2.0 — the presentation-only primitives home in apps/web. It is a SECOND
# root for check 3 (semantic-state tokens in prop definitions), which walked
# packages/ui/src alone. Scoped to `primitives/` and NOT to all of
# `components/`: DESIGN.md's ownership table puts error handling IN boundary
# components, so `components/ErrorBoundary.tsx` legitimately declares
# `error: Error | null` and a blanket `components/` scan would report it as a
# violation. `primitives/` is presentation-only by construction.
WEB_PRIMITIVES="$ROOT_DIR/apps/web/components/primitives"

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
#
# Two roots, not one. `packages/ui/src` was the only one until BF-2.0, which
# left `apps/web/components/` outside BOTH firewall layers — the `hexagen-ui`
# ESLint plugin is wired for `app/**` and `features/**` only, and this check
# walked packages/ui alone. `apps/web/components/primitives` is the
# presentation-only home the brownfield arc puts new primitives in, so it is
# held to the same prop contract as packages/ui.
#
# The roots are ANNOUNCED below rather than scanned silently: a check that
# walks a directory which has since been renamed away would otherwise print a
# green tick over zero files.
PROP_TOKEN_ROOTS=("$UI_SRC")
if [ -d "$WEB_PRIMITIVES" ]; then
  PROP_TOKEN_ROOTS+=("$WEB_PRIMITIVES")
fi

echo ""
echo "Checking for semantic state tokens in UI source..."
for _root in "${PROP_TOKEN_ROOTS[@]}"; do
  echo "  (root: ${_root#"$ROOT_DIR"/})"
done
if [ ! -d "$WEB_PRIMITIVES" ]; then
  echo "  ⚠️  ${WEB_PRIMITIVES#"$ROOT_DIR"/} not found — that root was NOT scanned."
fi
while IFS= read -r token; do
  for _root in "${PROP_TOKEN_ROOTS[@]}"; do
    if grep -rqE "(interface|type).*\\b${token}\\b" "$_root" 2>/dev/null; then
      echo "  ❌ Found forbidden token '${token}' in type/interface definition"
      grep -rnE "(interface|type).*\\b${token}\\b" "$_root" 2>/dev/null | while read -r line; do
        echo "     → $line"
      done
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done

  # Second predicate, primitives root only. `grep` is LINE-scoped, so the
  # predicate above only sees a forbidden name that shares a line with the
  # `interface`/`type` keyword — i.e. the single-line form
  # `type FooProps = { status: string }`. The dominant TypeScript spelling
  #
  #   interface FooProps {
  #     status: string;
  #   }
  #
  # puts the keyword and the name on different lines and sails straight
  # through (measured against a fixture: 0 findings). This pass matches the
  # PROPERTY DECLARATION itself, so both spellings are caught.
  #
  # It is deliberately NOT applied to packages/ui/src. That root has exactly
  # one hit — `packages/ui/src/types/forbidden-brand.ts`, the module that
  # DEFINES the brand and therefore has to name all eleven tokens (it already
  # carries a by-name exemption in check 8). Turning this on there means
  # adding a second exemption list for a root that is already covered by the
  # NoSemanticState brand check, which is a separate change with its own
  # review. `primitives/` is new and empty, so the stronger predicate costs
  # nothing there and starts with no baseline to grandfather.
  if [ -d "$WEB_PRIMITIVES" ]; then
    if grep -rqE "^[[:space:]]*(readonly[[:space:]]+)?${token}\\??[[:space:]]*:" \
      --include='*.ts' --include='*.tsx' "$WEB_PRIMITIVES" 2>/dev/null; then
      echo "  ❌ Found forbidden prop '${token}' declared in a primitive"
      grep -rnE "^[[:space:]]*(readonly[[:space:]]+)?${token}\\??[[:space:]]*:" \
        --include='*.ts' --include='*.tsx' "$WEB_PRIMITIVES" 2>/dev/null | while read -r line; do
        echo "     → $line"
      done
      echo "     components/primitives/ is presentation-only. Model interaction"
      echo "     state (isExpanded, variant, onAction), not information state."
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
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

# Relative specifiers are not the only way to cross a slice boundary, and in
# this repo they are not even the common one. apps/web/tsconfig.json maps
# "@/*" over ["./app/*","./components/*","./lib/*","./hooks/*","./features/*",
# "./types/*"], so `@/landing/x` resolves to features/landing/x. A check that
# only reads `../` specifiers scores 0 violations while 15 alias-form
# slice→slice imports sit in the tree — the "gate that verifies nothing" shape
# this script's own header warns about. Both forms are resolved below.
#
# Candidate roots BEFORE features/ in the tsconfig `paths` list. A first
# segment that exists under one of these resolves there, not into a slice, so
# it is not a cross-slice import. (No slice name is shadowed today; this keeps
# the check honest if one ever is.)
ALIAS_ROOTS_BEFORE_FEATURES="app components lib hooks"
WEB_ROOT="$ROOT_DIR/apps/web"

# Alias-form slice→slice imports that already existed when this check learned
# to see them. Pinned so the gate is green on today's tree but any NEW pair
# fails the build — the same ratchet UNLINTED uses in check-lint-coverage.mjs.
# Entries are "<importing-slice>|<specifier>". Shrink this list; do not grow
# it. A stale entry (coupling since removed) also fails, so it cannot rot into
# a permanent excuse.
CROSS_SLICE_ALIAS_BASELINE="
"
BASELINE_HITS=""

# Resolve an "@/..." specifier to the slice it lands in, or empty for anything
# that resolves outside features/ (lib/, hooks/, app/, types/, ...).
alias_slice_target() {
  local rest="${1#@/}"
  local seg="${rest%%/*}"
  local root
  [ -n "$seg" ] || return 0
  for root in $ALIAS_ROOTS_BEFORE_FEATURES; do
    [ -e "$WEB_ROOT/$root/$seg" ] && return 0
  done
  [ -d "$WEB_FEATURES/$seg" ] || return 0
  printf '%s' "$seg"
}

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
        case "$specifier" in
          @/*)
            # Alias form — resolved through tsconfig `paths`, not the filesystem.
            target="$(alias_slice_target "$specifier")"
            [ -n "$target" ] || continue
            ;;
          *)
            resolved="$(normalize_path "${file_dir}/${specifier}")"
            case "$resolved" in
              "$FEATURES_ROOT"/*) ;;
              *) continue ;;
            esac
            rest="${resolved#"$FEATURES_ROOT"/}"
            target="${rest%%/*}"
            ;;
        esac
        [ "$target" = "$slice_name" ] && continue
        [ "$target" = "$SHELL_SLICE" ] && continue
        if printf '%s' "$CROSS_SLICE_ALIAS_BASELINE" |
          grep -Fxq "${slice_name}|${specifier}"; then
          BASELINE_HITS="${BASELINE_HITS}${slice_name}|${specifier}
"
          continue
        fi
        echo "  ❌ Cross-slice import: $slice_name → $target"
        echo "     → $file: $specifier"
        VIOLATIONS=$((VIOLATIONS + 1))
      done < <(grep -ohE "from ['\"](\.\.?/|@/)[^'\"]*['\"]" "$file" 2>/dev/null |
        sed -E "s/^from ['\"](.*)['\"]$/\1/" || true)
    done < <(find "$slice_dir" \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null || true)
  done

  # A baseline entry whose coupling is gone must be deleted, or the list turns
  # into a permanent excuse that silently re-permits the import if it returns.
  while IFS= read -r pinned; do
    [ -n "$pinned" ] || continue
    if ! printf '%s' "$BASELINE_HITS" | grep -Fxq "$pinned"; then
      echo "  ❌ Stale cross-slice baseline entry — this import no longer exists:"
      echo "     → ${pinned}"
      echo "     Remove it from CROSS_SLICE_ALIAS_BASELINE in $(basename "${BASH_SOURCE[0]}")."
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < <(printf '%s' "$CROSS_SLICE_ALIAS_BASELINE")

  pinned_count="$(printf '%s' "$CROSS_SLICE_ALIAS_BASELINE" | grep -c . || true)"
  echo "  ($pinned_count pre-existing alias-form cross-slice import(s) pinned — shrink, do not grow)"
fi

# Check 7: neutral homes must not import from features/ (ADR-0055 §Decision 2)
#
# ADR-0055 names three neutral homes for code extracted out of a slice —
# app/lib (app-global context/infrastructure), components (shared
# presentational), lib (slice-agnostic config/preset/generated) — and requires
# that a neutral module NOT import from features/, because that inverts the
# dependency the extraction exists to remove. The ADR filed this as
# convention-held rather than gate-held: check 6 iterates slice directories
# only, so it is structurally blind to a neutral → slice edge.
#
# The blind spot was not theoretical. `app/contexts/ExportContext.tsx` imported
# the `export` slice's submit-payload types and re-published them in its public
# context signature, so `project-wizard` and three `workspace-shell` files were
# structurally bound to that slice through `@/contexts/ExportContext` — a
# specifier containing neither "../" nor a slice name, which neither the ESLint
# rule (relative specifiers only) nor check 6 (slice directories only) can see.
#
# Route composition roots are DELIBERATELY out of scope: app/**/page.tsx,
# layout.tsx and their client shells exist to mount slices, exactly as
# workspace-shell does. Only the extraction targets are scanned.
NEUTRAL_HOME_DIRS="app/lib app/contexts app/hooks lib components hooks"

# Pre-existing neutral → slice edges, pinned so the gate is green on today's
# tree while any NEW one fails. Entries are "<path-from-apps/web>|<specifier>".
# Shrink this list; do not grow it. A stale entry (edge since removed) also
# fails, so it cannot rot into permanent permission.
NEUTRAL_FEATURE_BASELINE="
app/lib/manifest-generation/capability-cache.ts|../../../features/manifest-generation/types/capabilities
app/lib/use-cases/project-lifecycle.use-case.ts|../../../features/governance-assistant/stores/useGovernanceThreadStore
app/lib/wire.client.discard-subscription.test.ts|../../features/governance-assistant/stores/useGovernanceThreadStore
"
NEUTRAL_BASELINE_HITS=""
# Set independently of check 6, which computes it inside its own `if`.
FEATURES_ROOT="$(normalize_path "$WEB_FEATURES")"

echo ""
echo "Checking for features/ imports from neutral homes (ADR-0055)..."
for neutral_dir in $NEUTRAL_HOME_DIRS; do
  [ -d "$WEB_ROOT/$neutral_dir" ] || continue
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    file_dir=$(dirname "$file")
    rel_file="${file#"$WEB_ROOT"/}"
    while IFS= read -r specifier; do
      case "$specifier" in
        @/*)
          target="$(alias_slice_target "$specifier")"
          [ -n "$target" ] || continue
          ;;
        *)
          resolved="$(normalize_path "${file_dir}/${specifier}")"
          case "$resolved" in
            "$FEATURES_ROOT"/*) ;;
            *) continue ;;
          esac
          rest="${resolved#"$FEATURES_ROOT"/}"
          target="${rest%%/*}"
          ;;
      esac
      if printf '%s' "$NEUTRAL_FEATURE_BASELINE" |
        grep -Fxq "${rel_file}|${specifier}"; then
        NEUTRAL_BASELINE_HITS="${NEUTRAL_BASELINE_HITS}${rel_file}|${specifier}
"
        continue
      fi
      echo "  ❌ Neutral home imports a feature slice: $rel_file → $target"
      echo "     → $specifier"
      echo "     ADR-0055 §Decision 2: extract the symbol to the neutral home"
      echo "     instead, or invert the import so the slice depends on it."
      VIOLATIONS=$((VIOLATIONS + 1))
    done < <(grep -ohE "from ['\"](\.\.?/|@/)[^'\"]*['\"]" "$file" 2>/dev/null |
      sed -E "s/^from ['\"](.*)['\"]$/\1/" || true)
  done < <(find "$WEB_ROOT/$neutral_dir" \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null || true)
done

while IFS= read -r pinned; do
  [ -n "$pinned" ] || continue
  if ! printf '%s' "$NEUTRAL_BASELINE_HITS" | grep -Fxq "$pinned"; then
    echo "  ❌ Stale neutral-home baseline entry — this import no longer exists:"
    echo "     → ${pinned}"
    echo "     Remove it from NEUTRAL_FEATURE_BASELINE in $(basename "${BASH_SOURCE[0]}")."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(printf '%s' "$NEUTRAL_FEATURE_BASELINE")

neutral_pinned_count="$(printf '%s' "$NEUTRAL_FEATURE_BASELINE" | grep -c . || true)"
echo "  ($neutral_pinned_count pre-existing neutral→slice import(s) pinned — shrink, do not grow)"

# Check 8: every component prop type in packages/ui carries the
# NoSemanticState brand (HEX-031 / DESIGN.md §3.4).
#
# DESIGN.md §3.4 says "All @hexagen/ui component props **must** extend
# NoSemanticState<T>", but nothing enforced the requirement, so Dialog, Tabs,
# Accordion, Skeleton and CopyButton shipped prop types that accept
# `loading`/`error`/`status`/`data` freely. Check 3 above is the complement,
# not a substitute: it only fires once someone has actually WRITTEN a
# forbidden token, whereas §3.4 makes the missing brand itself the defect —
# the brand is what turns the next such prop into a compile error at the call
# site rather than a lint finding after the fact.
#
# SCOPE. A declaration is in scope when it is an `interface`/`type` whose name
# ends in `Props` — nothing more. An earlier revision additionally required a
# same-line `extends`, `=` or `{`, which silently skipped two legal TypeScript
# forms and reported them as compliant:
#
#   export interface FooProps<T> extends Bar {}   // generic component contract
#   export interface FooProps                     // prettier-wrapped heritage
#     extends Bar {}
#
# Both are component contracts, and a skipped declaration is worse than a
# missing check because the gate prints "scanned" and a green tick over it.
# Scope is therefore purely name-shaped, and the one type-level *utility* that
# shape catches is exempted BY NAME below, where the exemption is visible and
# goes stale loudly.
#
# The modifier prefix is a REPEATED alternation, `((export|default|declare) )*`,
# not an optional `(export )?`. TypeScript allows the keywords to stack and to
# appear without `export` — `export default interface FooProps`,
# `export declare interface FooProps`, `declare interface FooProps` — and an
# `export`-only prefix skipped all three silently while the other 28 contracts
# held PROPS_SCANNED above its floor.
#
# BRAND DETECTION. The brand must be found in *type position*: the window is
# stripped of `//` comments and then required to match
# `(extends|=|&|\|) NoSemanticState<`. A bare `grep NoSemanticState` over the
# window (the earlier revision) accepted a comment or a string literal
# mentioning the token, so `// NoSemanticState is not needed here` above an
# unbranded interface passed the gate — and CopyButton.tsx really does carry
# such a comment two lines above its declaration.
#
# WINDOW. Prettier wraps long heritage clauses and union arms onto following
# lines (`AccordionRootProps =` / `| NoSemanticState<{`), so the window runs to
# 4 lines — but it is also cut at the line before the NEXT prop declaration in
# the same file, so a branded neighbour can never satisfy an unbranded
# declaration that happens to sit directly above it.
#
# There is deliberately NO baseline of unbranded types: every component prop
# type in packages/ui/src is branded today, and a baseline here would be a
# standing invitation to add the next unbranded one.

# Type-level utilities that are NOT component contracts. `AllowedProps<T>` is a
# mapped type living in the module that DEFINES the brand — branding it would
# be circular. Entries are "<path-from-repo-root>|<TypeName>". A stale entry
# (declaration renamed or deleted) fails, so an exemption cannot rot into
# permanent permission.
PROP_UTILITY_EXEMPTIONS="
packages/ui/src/types/forbidden-brand.ts|AllowedProps
"
PROP_UTILITY_HITS=""

echo ""
echo "Checking NoSemanticState brand on packages/ui prop types (DESIGN.md §3.4)..."
PROPS_SCANNED=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  rel_file="${file#"$ROOT_DIR"/}"
  file_lines="$(wc -l <"$file" | tr -d '[:space:]')"
  decl_lines=""
  while IFS= read -r decl; do
    [ -n "$decl" ] || continue
    decl_lines="${decl_lines}${decl}
"
  done < <(grep -nE "^[[:space:]]*((export|default|declare)[[:space:]]+)*(interface|type)[[:space:]]+[A-Za-z0-9_]*Props([^A-Za-z0-9_]|\$)" "$file" 2>/dev/null || true)
  decl_index=0
  while IFS= read -r decl; do
    [ -n "$decl" ] || continue
    decl_index=$((decl_index + 1))
    lineno="${decl%%:*}"
    name="$(printf '%s' "$decl" |
      sed -E 's/^[0-9]+:[[:space:]]*((export|default|declare)[[:space:]]+)*(interface|type)[[:space:]]+([A-Za-z0-9_]*Props).*/\4/')"

    if printf '%s' "$PROP_UTILITY_EXEMPTIONS" | grep -Fxq "${rel_file}|${name}"; then
      PROP_UTILITY_HITS="${PROP_UTILITY_HITS}${rel_file}|${name}
"
      continue
    fi

    PROPS_SCANNED=$((PROPS_SCANNED + 1))

    # Cut the window at the line before the next prop declaration so a branded
    # neighbour cannot vouch for an unbranded declaration above it.
    next_lineno="$(printf '%s' "$decl_lines" |
      sed -n "$((decl_index + 1))p" | cut -d: -f1)"
    window_end=$((lineno + 3))
    if [ -n "$next_lineno" ] && [ "$next_lineno" -le "$window_end" ]; then
      window_end=$((next_lineno - 1))
    fi
    [ "$window_end" -gt "$file_lines" ] && window_end="$file_lines"

    # `//` comments stripped, then newlines folded, so a wrapped
    # `=\n  | NoSemanticState<{` still reads as one anchored match while a
    # commented-out or quoted mention of the token does not.
    if sed -n "${lineno},${window_end}p" "$file" |
      sed -E 's://.*$::' |
      tr '\n' ' ' |
      grep -qE '(extends|=|&|\|)[[:space:]]*NoSemanticState[[:space:]]*<'; then
      continue
    fi
    echo "  ❌ Prop type without NoSemanticState brand: $name"
    echo "     → ${rel_file}:${lineno}"
    echo "     DESIGN.md §3.4: every @hexagen/ui prop type must extend"
    echo "     NoSemanticState<T> so information state cannot reach presentation."
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(printf '%s' "$decl_lines")
done < <(find "$UI_SRC" \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null || true)

while IFS= read -r pinned; do
  [ -n "$pinned" ] || continue
  if ! printf '%s' "$PROP_UTILITY_HITS" | grep -Fxq "$pinned"; then
    echo "  ❌ Stale prop-utility exemption — this declaration no longer exists:"
    echo "     → ${pinned}"
    echo "     Remove it from PROP_UTILITY_EXEMPTIONS in $(basename "${BASH_SOURCE[0]}")."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(printf '%s' "$PROP_UTILITY_EXEMPTIONS")

# Anti-vacuity: this check scans a population, so a broken pattern (renamed
# directory, tightened regex, `find` returning nothing) would report a clean
# sweep of zero files. packages/ui has had double-digit prop types since the
# design-system split; refuse to certify compliance below that.
if [ "$PROPS_SCANNED" -lt 10 ]; then
  echo "  ❌ Only ${PROPS_SCANNED} prop type(s) scanned under ${UI_SRC}."
  echo "     The brand check found essentially nothing to check — treat that as"
  echo "     a broken scan, not as compliance."
  exit 2
fi
echo "  ($PROPS_SCANNED prop type(s) scanned)"

echo ""
echo "============================================================"
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "❌ UI Boundary Check FAILED — $VIOLATIONS violation(s) found"
  exit 1
else
  echo "✅ UI Boundary Check PASSED — no violations found"
  exit 0
fi
