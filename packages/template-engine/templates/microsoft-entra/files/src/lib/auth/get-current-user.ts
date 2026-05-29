import { cookies } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { decryptSession } from "../../infrastructure/auth/entra/session-store";
import { mapEntraUserToUserContext } from "../../infrastructure/auth/entra/user-profile-mapper";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "{session_cookie_name}";

export async function getCurrentUser(): Promise<UserContext | null> {
  if (process.env.AUTH_MODE === "mock") return MOCK_USER;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const user = await decryptSession(token);
  if (!user) return null;
  return mapEntraUserToUserContext(user);
}
