import { NextRequest, NextResponse } from "next/server";
import { IMSClient } from "../../../../src/infrastructure/auth/adobe-ims/ims-client";
import { AdobeIMSAuthAdapter } from "../../../../src/infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { buildTokenCookieHeader } from "../../../../src/infrastructure/auth/adobe-ims/token-store";
import { buildSessionCookieHeader } from "../../../../src/infrastructure/auth/session/session-manager";

const PKCE_COOKIE = "__ims_pkce";
const STATE_COOKIE = "__ims_state";
const IS_SECURE = process.env.NODE_ENV === "production";

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey.trim() === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function clearShortCookie(name: string): string {
  const parts = [
    `${name}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Path=/api/auth/callback",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}

const imsClient = new IMSClient();
const adapter = new AdobeIMSAuthAdapter();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const verifier = readCookie(cookieHeader, PKCE_COOKIE);
  const savedState = readCookie(cookieHeader, STATE_COOKIE);

  if (!verifier || !savedState) {
    return NextResponse.json({ error: "Missing PKCE verifier or state cookie" }, { status: 400 });
  }

  if (returnedState !== savedState) {
    return NextResponse.json({ error: "State mismatch — possible CSRF" }, { status: 400 });
  }

  let tokens;
  try {
    tokens = await imsClient.exchangeCode(code, verifier);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }

  const sessionToken = await adapter.createSessionFromTokens(tokens);

  const response = NextResponse.redirect(new URL("/dashboard", request.url));

  // Clear PKCE + state cookies
  response.headers.append("Set-Cookie", clearShortCookie(PKCE_COOKIE));
  response.headers.append("Set-Cookie", clearShortCookie(STATE_COOKIE));

  // Set encrypted token cookie + session cookie
  response.headers.append("Set-Cookie", buildTokenCookieHeader(sessionToken, IS_SECURE));
  response.headers.append("Set-Cookie", buildSessionCookieHeader(sessionToken));

  return response;
}
