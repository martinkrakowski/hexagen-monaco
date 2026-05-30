import { cookies, headers } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { decryptSession } from "../../infrastructure/auth/entra/session-store";
import { mapEntraUserToUserContext } from "../../infrastructure/auth/entra/user-profile-mapper";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";
import { COOKIE_NAME } from "../../infrastructure/auth/session/session-manager";


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

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const user = await decryptSession(token);
  if (!user) return null;
  return mapEntraUserToUserContext(user);
}
