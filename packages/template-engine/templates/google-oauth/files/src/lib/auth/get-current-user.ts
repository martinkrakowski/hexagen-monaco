import { cookies } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { decryptSession } from "../../infrastructure/auth/google/session-store";
import { mapGoogleUserToUserContext } from "../../infrastructure/auth/google/user-profile-mapper";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "__auth_session";

// Server-only helper for resolving the current user inside Server Components,
// Route Handlers, and Server Actions. Mirrors the middleware: honours
// AUTH_MODE=mock, then reads the Google session cookie and maps to UserContext.
export async function getCurrentUser(): Promise<UserContext | null> {
  if (process.env.AUTH_MODE === "mock") return MOCK_USER;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const user = await decryptSession(token);
  if (!user) return null;
  return mapGoogleUserToUserContext(user);
}
