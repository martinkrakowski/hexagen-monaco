import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl } from "../../../../../src/infrastructure/auth/github/github-client";

const STATE_COOKIE = "__github_state";
const STATE_TTL = 300;
const IS_SECURE = process.env.NODE_ENV === "production";

function generateState(): string {
  const random = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(random);
  let binary = "";
  for (const b of random) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function stateCookie(value: string): string {
  const parts = [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    `Max-Age=${STATE_TTL}`,
    "Path=/api/auth/callback/github",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const state = generateState();
  const response = NextResponse.redirect(buildAuthorizeUrl(state));
  response.headers.append("Set-Cookie", stateCookie(state));
  return response;
}
