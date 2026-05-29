import type { UserContext } from "../../domain/value-objects/user-context";
import { createSupabaseServerClient } from "../../infrastructure/supabase/server";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

// Server-only helper. Honours AUTH_MODE=mock, then calls supabase.auth.getUser()
// (server-validated JWT — never trust getSession() here) and maps the Supabase
// user to UserContext.
export async function getCurrentUser(): Promise<UserContext | null> {
  if (process.env.AUTH_MODE === "mock") return MOCK_USER;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const meta = (data.user.user_metadata ?? {}) as {
      name?: string;
      full_name?: string;
      avatar_url?: string;
    };
    return {
      id: data.user.id,
      email: data.user.email ?? "",
      name: meta.full_name ?? meta.name ?? data.user.email ?? data.user.id,
      roles: ["user"],
      avatarUrl: meta.avatar_url,
    };
  } catch {
    return null;
  }
}
