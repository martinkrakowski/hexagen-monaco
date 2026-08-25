import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  CSRF_COOKIE_NAME,
  CSRF_ERROR_CODE,
  CSRF_HEADER_NAME,
  csrfTokensMatch,
} from "./lib/csrf";

export const PROTECTED_PATH_PREFIXES = ["/account", "/billing"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * D-H7 (2026-08-25) — every mutation under `/api` requires the double-submit
 * header WHEN the request carries a NextAuth session cookie. Uniform on
 * purpose: the API tree mixes session-authorized families (projects, tenants,
 * orgs, runs, byok, account) with anonymous-quota routes (generate,
 * governance, scan — ADR-0063), sometimes under the SAME prefix
 * (`/api/projects/scan` is anonymous, `/api/projects` is not). A per-family
 * allowlist here would need re-litigating on every new route, and getting it
 * wrong on the permissive side silently un-guards a session surface. Instead:
 * one rule, and one client convention — every mutating client fetch goes
 * through `fetchWithCsrf` (app/lib/csrf-fetch.ts), so signed-in users carry
 * the header everywhere, and anonymous/cookie-less callers (the wedge, CI,
 * curl) never meet the check at all.
 *
 * Exemptions, both deliberate:
 * - `/api/auth/**` is NextAuth's own surface and carries NextAuth's own CSRF
 *   protection — double-guarding it would break the sign-in flow.
 * - `/api/csrf` is the token issuance seam (GET-only anyway); the bootstrap
 *   request must never require the token it mints.
 *
 * Enforcement lives HERE, in middleware, and nowhere else: it is the single
 * choke point every API route passes through, including the BYOK routes that
 * authenticate via `getServerSession` rather than `requirePersistenceOwner`.
 * A per-route guard is how one route ends up unguarded.
 */
export const CSRF_EXEMPT_API_PREFIXES = ["/api/auth", "/api/csrf"] as const;

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export function isCsrfEnforcedApiPath(pathname: string): boolean {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return false;
  return !CSRF_EXEMPT_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Presence, not validity: if the browser sent a session cookie at all, the
 * request is treated as cookie-authenticated for CSRF purposes. An invalid
 * cookie fails auth downstream anyway (401), and firing the CSRF check on a
 * garbage cookie is harmless — while validating the JWT here would decode it
 * twice per request for no additional safety. Cookie-less callers — the CLI,
 * CI, curl, and the anonymous quota flows — never reach the check, which is
 * exactly the "wedge/API paths unaffected" contract of H0.5.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export function csrfDenial(): NextResponse {
  return NextResponse.json(
    {
      error: CSRF_ERROR_CODE,
      message:
        "Missing or mismatched CSRF token. Refetch /api/csrf and retry with " +
        `the ${CSRF_HEADER_NAME} header.`,
      statusCode: 403,
    },
    // no-store: a cached 403 would keep denying after the client has
    // bootstrapped a fresh token.
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * The D-H7 gate, factored out of `middleware` so tests can drive it with a
 * bare NextRequest. Returns a 403 to short-circuit, or null to proceed.
 */
export function guardApiCsrf(request: NextRequest): NextResponse | null {
  if (!isCsrfEnforcedApiPath(request.nextUrl.pathname)) return null;
  if (!MUTATING_METHODS.has(request.method)) return null;
  if (!hasSessionCookie(request)) return null;

  const cookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const header = request.headers.get(CSRF_HEADER_NAME);
  if (!csrfTokensMatch(cookie, header)) return csrfDenial();
  return null;
}

export async function middleware(request: NextRequest) {
  const denied = guardApiCsrf(request);
  if (denied) return denied;

  if (!isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const token = await getToken({ req: request });
  if (token) return NextResponse.next();
  const signIn = new URL("/auth/signin", request.url);
  signIn.searchParams.set("callbackUrl", request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: [
    "/account/:path*",
    "/billing/:path*",
    "/account",
    "/billing",
    "/api/:path*",
  ],
};
