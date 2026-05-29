const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "{session_cookie_name}";
const MAX_AGE = (() => {
  const n = parseInt(process.env.AUTH_SESSION_MAX_AGE ?? "604800", 10);
  return Number.isFinite(n) && n > 0 ? n : 604800;
})();
const IS_SECURE = process.env.NODE_ENV === "production";

/**
 * Reads the session cookie value from a standard Request.
 * Compatible with Next.js route handlers and Edge middleware.
 */
export function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey.trim() === COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

/**
 * Builds a Set-Cookie header string for the given session token.
 */
export function buildSessionCookieHeader(token: string): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Builds a Set-Cookie header string that expires the session cookie immediately.
 * Mirrors the same attributes as buildSessionCookieHeader so browsers correctly
 * overwrite the existing cookie (Secure must match in production).
 */
export function buildClearSessionCookieHeader(): string {
  const parts = [
    `${COOKIE_NAME}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}
