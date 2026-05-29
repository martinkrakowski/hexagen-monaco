import { cookies, headers } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { decryptSession } from "../../infrastructure/auth/google/session-store";
import { mapGoogleUserToUserContext } from "../../infrastructure/auth/google/user-profile-mapper";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "__auth_session";

// Server-only helper. Honours AUTH_MODE=mock, then short-circuits via the
// x-user-context header that middleware emits after validating the session
// (middleware strips any client-supplied value first, so the header is
// trustworthy when present). Falls back to the cookie path when missing —
// e.g. on non-protected paths where middleware doesn't validate.
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
    // headers() is unavailable outside a request context — fall through.
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const user = await decryptSession(token);
  if (!user) return null;
  return mapGoogleUserToUserContext(user);
}
