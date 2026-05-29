import { cookies, headers } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import {
  AdobeIMSAuthAdapter,
  type ValidatedSession,
} from "../../infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "__auth_session";
const adapter = new AdobeIMSAuthAdapter();

// Server-only helper for Server Components / Server Actions. Short-circuits
// via the x-user-context header that middleware emits on protected paths.
// Server Components can't reliably set cookies, so the fallback path drops
// any refreshedToken — the next middleware run picks it up.
//
// Route handlers that need to persist the refreshed token (e.g. /api/auth/me)
// should call getValidatedSession() instead and write Set-Cookie themselves.
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
  const result = await adapter.validate(token);
  return result ? result.user : null;
}

// Route-handler-oriented helper. Returns the full ValidatedSession including
// refreshedToken so the caller can persist the rotated token bundle back to
// the cookie via Set-Cookie + buildSessionCookieHeader.
export async function getValidatedSession(): Promise<ValidatedSession | null> {
  if (process.env.AUTH_MODE === "mock") {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("AUTH_MODE=mock is only supported in development");
    }
    return { user: MOCK_USER };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return adapter.validate(token);
}
