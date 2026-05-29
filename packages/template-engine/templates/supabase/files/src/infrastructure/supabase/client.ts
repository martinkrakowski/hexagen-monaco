import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types/database.types";

// Browser client (singleton). Uses the public anon key — safe to ship to the
// browser. Never use this in server code: it does not propagate auth cookies.
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
