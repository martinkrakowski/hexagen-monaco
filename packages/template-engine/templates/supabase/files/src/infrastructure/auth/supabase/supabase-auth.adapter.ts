import type { AuthProviderPort } from "../../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../../domain/value-objects/user-context";
import { createSupabaseServerClient } from "../../supabase/server";

// Wires Supabase Auth into auth-mock's RealAuthAdapter slot. Supabase manages
// sessions via cookies on the server client, so validate() ignores its
// sessionToken argument and reads the request-scoped session instead.
export class SupabaseAuthAdapter implements AuthProviderPort {
  async validate(_sessionToken: string): Promise<UserContext | null> {
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
  }

  async createSession(_user: UserContext): Promise<string> {
    // Supabase issues its own session via supabase.auth.signInWith*() — there
    // is no separate token to mint here.
    throw new Error(
      "SupabaseAuthAdapter.createSession is managed by Supabase — sign users in via supabase.auth methods (e.g. signInWithPassword, signInWithOAuth).",
    );
  }

  async revokeSession(_sessionToken: string): Promise<void> {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
}
