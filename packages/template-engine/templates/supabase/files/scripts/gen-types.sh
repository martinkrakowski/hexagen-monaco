#!/bin/bash
set -euo pipefail

# Regenerate TypeScript types from the local Supabase schema.
# Requires the supabase CLI and a running local instance (supabase start).
supabase gen types typescript --local \
  > src/infrastructure/supabase/types/database.types.ts

echo "✅ Types generated → src/infrastructure/supabase/types/database.types.ts"
