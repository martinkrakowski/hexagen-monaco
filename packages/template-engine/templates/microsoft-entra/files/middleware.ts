import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken } from "./src/infrastructure/auth/session/session-manager";
import { decryptSession } from "./src/infrastructure/auth/entra/session-store";
import { mapEntraUserToUserContext } from "./src/infrastructure/auth/entra/user-profile-mapper";
import { MOCK_USER } from "./src/infrastructure/auth/mock-user";

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
    return NextResponse.redirect(new URL("/api/auth/login/entra", request.url));
  }
  const user = await decryptSession(token);
  if (!user) {
    return NextResponse.redirect(new URL("/api/auth/login/entra", request.url));
  }

  const headers = new Headers(request.headers);
  headers.set("x-user-context", JSON.stringify(mapEntraUserToUserContext(user)));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
