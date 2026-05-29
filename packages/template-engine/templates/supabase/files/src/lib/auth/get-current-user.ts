import { headers } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { createSupabaseServerClient } from "../../infrastructure/supabase/server";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

// Server-only helper. Honours AUTH_MODE=mock, then short-circuits via the
// x-user-context header that middleware emits after validating the Supabase
// session (middleware strips any client-supplied value first). Falls back to
// a fresh supabase.auth.getUser() (server-validated JWT — never trust
// getSession() locally) when the header is missing.
export async function getCurrentUser(): Promise<UserContext | null> {
  if (process.env.AUTH_MODE === "mock") {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("AUTH_MODE=mock is only supported in development");
    }
    return MOCK_USER;
  }

  try {
    const reqHeaders = await headers();
    const cached = reqHeaders.get("x-user-context");
    if (cached) return JSON.parse(cached) as UserContext;
  } catch {
    // headers() unavailable outside a request context — fall through.
  }

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
