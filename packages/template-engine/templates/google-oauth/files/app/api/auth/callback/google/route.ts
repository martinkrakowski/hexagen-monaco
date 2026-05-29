import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getUserInfo } from "../../../../../src/infrastructure/auth/google/google-client";
import { mapGoogleUserInfo } from "../../../../../src/infrastructure/auth/google/user-profile-mapper";
import { GoogleAuthAdapter } from "../../../../../src/infrastructure/auth/google/google-auth.adapter";
import { buildSessionCookieHeader } from "../../../../../src/infrastructure/auth/session/session-manager";

const STATE_COOKIE = "__google_state";
const IS_SECURE = process.env.NODE_ENV === "production";

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey.trim() === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function clearStateCookie(): string {
  const parts = [
    `${STATE_COOKIE}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Path=/api/auth/callback/google",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}

const adapter = new GoogleAuthAdapter();

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
  const savedState = readCookie(cookieHeader, STATE_COOKIE);

  if (!savedState || returnedState !== savedState) {
    return NextResponse.json({ error: "State mismatch — possible CSRF" }, { status: 400 });
  }

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("Google token exchange failed", err);
    return NextResponse.redirect(new URL("/login?error=token_exchange_failed", request.url));
  }

  let sessionToken;
  try {
    const userInfo = await getUserInfo(tokens.access_token);
    const googleUser = mapGoogleUserInfo(userInfo);
    sessionToken = await adapter.createSessionFromGoogleUser(googleUser);
  } catch (err) {
    console.error("Google profile fetch / session creation failed", err);
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.headers.append("Set-Cookie", clearStateCookie());
  response.headers.append("Set-Cookie", buildSessionCookieHeader(sessionToken));
  return response;
}
