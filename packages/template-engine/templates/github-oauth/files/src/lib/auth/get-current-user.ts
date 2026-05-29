import { cookies } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { decryptSession } from "../../infrastructure/auth/github/session-store";
import { mapGitHubUserToUserContext } from "../../infrastructure/auth/github/user-profile-mapper";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "__auth_session";

export async function getCurrentUser(): Promise<UserContext | null> {
  if (process.env.AUTH_MODE === "mock") return MOCK_USER;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const user = await decryptSession(token);
  if (!user) return null;
  return mapGitHubUserToUserContext(user);
}
