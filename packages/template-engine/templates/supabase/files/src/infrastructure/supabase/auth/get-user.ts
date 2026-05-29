import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../server";

// Returns the authenticated user, or null. Uses getUser(), which validates the
// JWT server-side on every call — getSession() (which trusts the local JWT
// without validation) is intentionally not exposed. Never throws.
export async function getCurrentUser(): Promise<User | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
}
