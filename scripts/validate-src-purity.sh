#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

VIOLATIONS=0

while IFS= read -r -d '' f; do
  echo "ERROR: Build artifact in src/: $f"
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(find packages -path '*/src/*' \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.js' \) ! -path '*/node_modules/*' -print0)

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "❌ Found $VIOLATIONS build artifact(s) in src/ directories."
  echo "   Only .ts/.tsx source files may exist under src/."
  echo "   Run: find packages -path '*/src/*' \\( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.js' \\) -delete"
  exit 1
fi

echo "✅ src/ directories are pure — no build artifacts detected."
