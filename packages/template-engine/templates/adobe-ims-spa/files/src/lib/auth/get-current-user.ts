import { cookies, headers } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { AdobeIMSAuthAdapter } from "../../infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "__auth_session";
const adapter = new AdobeIMSAuthAdapter();

// Server-only helper. Short-circuits via the x-user-context header that
// middleware emits on protected paths — this matters most for IMS because
// fallback validation requires a network round-trip to IMS for profile
// fetch (and possibly token refresh). The fallback path's refreshedToken is
// dropped (Server Components can't reliably set cookies); the next
// middleware run picks up the refresh.
export async function getCurrentUser(): Promise<UserContext | null> {
  if (process.env.AUTH_MODE === "mock") return MOCK_USER;

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
