import { NextRequest, NextResponse } from "next/server";
import { generatePKCEPair, generateState } from "../../../../../src/infrastructure/auth/entra/pkce";
import { buildAuthorizeUrl } from "../../../../../src/infrastructure/auth/entra/entra-client";

const PKCE_COOKIE = "__entra_pkce";
const STATE_COOKIE = "__entra_state";
const PKCE_TTL = 300;
const IS_SECURE = process.env.NODE_ENV === "production";

function shortCookie(name: string, value: string): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${PKCE_TTL}`,
    "Path=/api/auth/callback/entra",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const { verifier, challenge } = await generatePKCEPair();
  const state = generateState();
  const response = NextResponse.redirect(buildAuthorizeUrl(challenge, state));
  response.headers.append("Set-Cookie", shortCookie(PKCE_COOKIE, verifier));
  response.headers.append("Set-Cookie", shortCookie(STATE_COOKIE, state));
  return response;
}
