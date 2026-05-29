import { NextResponse, type NextRequest } from "next/server";
import {
  readSessionToken,
  buildSessionCookieHeader,
} from "./src/infrastructure/auth/session/session-manager";
import { AdobeIMSAuthAdapter } from "./src/infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { MOCK_USER } from "./src/infrastructure/auth/mock-user";

// Root middleware. On protected paths, validates the encrypted IMS-tokens
// cookie by calling IMS (fetchProfile + optional refresh). When refresh
// fires, the new encrypted blob is written back via Set-Cookie so subsequent
// requests don't pay the refresh round-trip. x-user-context is stripped from
// incoming headers on every code path so it can only carry middleware-
// validated values.
const PROTECTED_PATHS = "{protected_paths}"
  .split(",")
  .map((p) => {
    const trimmed = p.trim();
    // Preserve "/" as the literal root path; only strip trailing slashes for non-root.
    return trimmed === "/" ? "/" : trimmed.replace(/\/+$/, "");
  })
  .filter(Boolean);

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (prefix) =>
      prefix === "/" ||
      pathname === prefix ||
      pathname.startsWith(prefix + "/"),
  );
}

const adapter = new AdobeIMSAuthAdapter();

export default async function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("x-user-context");

  if (process.env.AUTH_MODE === "mock") {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("AUTH_MODE=mock is only supported in development");
    }
    headers.set("x-user-context", JSON.stringify(MOCK_USER));
    return NextResponse.next({ request: { headers } });
  }

  const { pathname } = request.nextUrl;
  if (!isProtected(pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  const token = readSessionToken(request);
  if (!token) {
    return NextResponse.redirect(new URL("/api/auth/login", request.url));
  }
  const result = await adapter.validate(token);
  if (!result) {
    return NextResponse.redirect(new URL("/api/auth/login", request.url));
  }

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
