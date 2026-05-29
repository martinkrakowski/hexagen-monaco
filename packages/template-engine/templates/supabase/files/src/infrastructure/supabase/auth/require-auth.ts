import type { User } from "@supabase/supabase-js";
import { getCurrentUser } from "./get-user";
import { AuthenticationError } from "../result";

// Returns the authenticated user or throws AuthenticationError. For use in
// Server Actions and API routes that must not proceed without a session.
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  return user;
}
