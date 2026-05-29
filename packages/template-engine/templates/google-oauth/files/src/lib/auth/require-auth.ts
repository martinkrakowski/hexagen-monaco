import { redirect } from "next/navigation";
import type { UserContext } from "../../domain/value-objects/user-context";
import { hasRole } from "../../domain/value-objects/user-context";
import { getCurrentUser } from "./get-current-user";

// Use inside Server Components / Server Actions to force a login redirect when
// no user is present. Optionally enforce a role.
export async function requireAuth(role?: string): Promise<UserContext> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/login/google");
  if (role && !hasRole(user, role)) redirect("/");
  return user;
}
