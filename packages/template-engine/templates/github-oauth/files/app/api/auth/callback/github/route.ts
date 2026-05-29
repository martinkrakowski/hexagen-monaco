import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCode,
  fetchUser,
  fetchPrimaryEmail,
  checkOrgMembership,
} from "../../../../../src/infrastructure/auth/github/github-client";
import { GITHUB_CONFIG } from "../../../../../src/infrastructure/auth/github/config";
import { mapGitHubUser } from "../../../../../src/infrastructure/auth/github/user-profile-mapper";
import { GitHubAuthAdapter } from "../../../../../src/infrastructure/auth/github/github-auth.adapter";
import { buildSessionCookieHeader } from "../../../../../src/infrastructure/auth/session/session-manager";

const STATE_COOKIE = "__github_state";
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
    "Path=/api/auth/callback/github",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}

const adapter = new GitHubAuthAdapter();

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

  let accessToken: string;
  try {
    const tokens = await exchangeCode(code);
    accessToken = tokens.access_token;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }

  let sessionToken: string;
  try {
    const [ghUser, primaryEmail] = await Promise.all([
      fetchUser(accessToken),
      fetchPrimaryEmail(accessToken),
    ]);

    // Org membership gate — checked before creating the session
    if (GITHUB_CONFIG.allowedOrgs.length > 0) {
      const memberships = await Promise.all(
        GITHUB_CONFIG.allowedOrgs.map((org) => checkOrgMembership(accessToken, org, ghUser.login)),
      );
      if (!memberships.some(Boolean)) {
        const orgs = GITHUB_CONFIG.allowedOrgs.join(", ");
        return NextResponse.redirect(
          new URL(
            `/login?error=${encodeURIComponent(`Access restricted to members of: ${orgs}`)}`,
            request.url,
          ),
        );
      }
    }

    const githubUser = mapGitHubUser(ghUser, primaryEmail);
    sessionToken = await adapter.createSessionFromGitHubUser(githubUser);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Profile fetch failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.headers.append("Set-Cookie", clearStateCookie());
  response.headers.append("Set-Cookie", buildSessionCookieHeader(sessionToken));
  return response;
}
