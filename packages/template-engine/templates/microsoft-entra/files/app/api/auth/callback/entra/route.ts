import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, fetchProfile, fetchGroupIds } from "../../../../../src/infrastructure/auth/entra/entra-client";
import { ENTRA_CONFIG } from "../../../../../src/infrastructure/auth/entra/config";
import { mapGroupsToRoles } from "../../../../../src/infrastructure/auth/entra/group-role-mapper";
import { mapEntraProfile } from "../../../../../src/infrastructure/auth/entra/user-profile-mapper";
import { EntraAuthAdapter } from "../../../../../src/infrastructure/auth/entra/entra-auth.adapter";
import { buildSessionCookieHeader } from "../../../../../src/infrastructure/auth/session/session-manager";

const PKCE_COOKIE = "__entra_pkce";
const STATE_COOKIE = "__entra_state";
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
    "Path=/api/auth/callback/entra",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}

const adapter = new EntraAuthAdapter();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    const description = searchParams.get("error_description") ?? error;
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(description)}`, request.url),
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

  let accessToken: string;
  try {
    const tokens = await exchangeCode(code, verifier);
    accessToken = tokens.access_token;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }

  let sessionToken: string;
  try {
    const [profile, groupIds] = await Promise.all([
      fetchProfile(accessToken),
      ENTRA_CONFIG.groupRoleMapping ? fetchGroupIds(accessToken) : Promise.resolve([]),
    ]);
    const roles = mapGroupsToRoles(groupIds);
    const entraUser = mapEntraProfile(profile, groupIds, roles);
    sessionToken = await adapter.createSessionFromEntraUser(entraUser);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Profile fetch failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.headers.append("Set-Cookie", clearShortCookie(PKCE_COOKIE));
  response.headers.append("Set-Cookie", clearShortCookie(STATE_COOKIE));
  response.headers.append("Set-Cookie", buildSessionCookieHeader(sessionToken));
  return response;
}
