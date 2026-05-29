import { NextResponse, type NextRequest } from "next/server";
import {
  readSessionToken,
  buildSessionCookieHeader,
} from "./src/infrastructure/auth/session/session-manager";
import { AdobeIMSAuthAdapter } from "./src/infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { MOCK_USER } from "./src/infrastructure/auth/mock-user";

// Root middleware. Honours AUTH_MODE=mock as a dev short-circuit, then on
// protected paths validates the encrypted IMS-tokens cookie by calling IMS
// (fetchProfile + optional refresh) and emits the resolved UserContext as
// x-user-context. When validate refreshes the access token, the new
// encrypted IMSTokens blob is written back via Set-Cookie so subsequent
// requests don't pay the refresh round-trip.
const PROTECTED_PATHS = "{protected_paths}"
  .split(",")
  .map((p) => p.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

const adapter = new AdobeIMSAuthAdapter();

export default async function middleware(request: NextRequest) {
  if (process.env.AUTH_MODE === "mock") {
    const headers = new Headers(request.headers);
    headers.set("x-user-context", JSON.stringify(MOCK_USER));
    return NextResponse.next({ request: { headers } });
  }

  const { pathname } = request.nextUrl;
  if (!isProtected(pathname)) return NextResponse.next();

  const token = readSessionToken(request);
  if (!token) {
    return NextResponse.redirect(new URL("/api/auth/login", request.url));
  }
  const result = await adapter.validate(token);
  if (!result) {
    return NextResponse.redirect(new URL("/api/auth/login", request.url));
  }

  const headers = new Headers(request.headers);
  headers.set("x-user-context", JSON.stringify(result.user));
  const response = NextResponse.next({ request: { headers } });
  if (result.refreshedToken) {
    response.headers.append(
      "Set-Cookie",
      buildSessionCookieHeader(result.refreshedToken),
    );
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
