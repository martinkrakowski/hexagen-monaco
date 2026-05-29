import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken } from "./src/infrastructure/auth/session/session-manager";
import { decryptSession } from "./src/infrastructure/auth/magic-link/session-store";
import { MOCK_USER } from "./src/infrastructure/auth/mock-user";

// Root middleware. Honours AUTH_MODE=mock as a dev short-circuit, then
// validates the magic-link session cookie on protected paths. The session
// payload IS the UserContext (magic-link has no third-party user model), so no
// mapper step is needed here.
const PROTECTED_PATHS = "{protected_paths}"
  .split(",")
  .map((p) => p.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

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
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const user = await decryptSession(token);
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const headers = new Headers(request.headers);
  headers.set("x-user-context", JSON.stringify(user));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
