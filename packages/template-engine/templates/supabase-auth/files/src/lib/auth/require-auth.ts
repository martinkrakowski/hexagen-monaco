import { redirect } from "next/navigation";
import type { UserContext } from "../../domain/value-objects/user-context";
import { hasRole } from "../../domain/value-objects/user-context";
import { getCurrentUser } from "./get-current-user";

export async function requireAuth(role?: string): Promise<UserContext> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (role && !hasRole(user, role)) redirect("/");
  return user;
}
