import { NextRequest, NextResponse } from "next/server";
import { authService, MOCK_USER } from "../../src/infrastructure/auth";
import {
  readSessionToken,
  buildSessionCookieHeader,
} from "../../src/infrastructure/auth/session/session-manager";

/**
 * Protected path prefixes. Requests to these paths require a valid session.
 * Edit this list or replace with your Next.js middleware matcher config.
 */
const PROTECTED_PREFIXES = (process.env.AUTH_PROTECTED_PATHS ?? "{protected_paths}")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Auth middleware — wire this into your root middleware.ts:
 *
 *   import { authMiddleware } from "./server/middleware/auth.middleware";
 *   export default authMiddleware;
 *   export const config = { matcher: ["/api/:path*", "/dashboard/:path*"] };
 */
export async function authMiddleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!isProtected(pathname)) {
    return NextResponse.next();
  }

  const token = readSessionToken(request);

  if (process.env.AUTH_MODE !== "real") {
    // Mock mode: auto-mint a session if the cookie is absent or stale
    const user = token ? await authService.getCurrentUser(token) : null;
    const activeToken = user ? token! : await authService.createSession(MOCK_USER);

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-context", JSON.stringify(user ?? MOCK_USER));

    const response = NextResponse.next({ request: { headers: requestHeaders } });

    if (!user) {
      response.headers.append("Set-Cookie", buildSessionCookieHeader(activeToken));
    }

    return response;
  }

  // Real mode: validate session; reject if missing or invalid
  if (!token) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const user = await authService.getCurrentUser(token);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-context", JSON.stringify(user));
  return NextResponse.next({ request: { headers: requestHeaders } });
}
