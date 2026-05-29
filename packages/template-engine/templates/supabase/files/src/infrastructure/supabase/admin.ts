import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types/database.types";

// Service-role client — BYPASSES Row Level Security. Server-only; never import
// this from client code or a client-facing barrel. Named `admin` on purpose so
// RLS-bypassing usage is obvious in review.
let admin: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for the admin client (server-only).",
    );
  }
  if (!admin) {
    admin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return admin;
}
