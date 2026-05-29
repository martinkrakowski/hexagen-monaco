import { NextRequest, NextResponse } from "next/server";
import { generatePKCEPair, buildAuthorizeUrl, generateState } from "../../../../src/infrastructure/auth/adobe-ims/pkce";

const PKCE_COOKIE = "__ims_pkce";
const STATE_COOKIE = "__ims_state";
const PKCE_TTL = 300; // seconds
const IS_SECURE = process.env.NODE_ENV === "production";

function shortCookie(name: string, value: string): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${PKCE_TTL}`,
    "Path=/api/auth/callback",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (IS_SECURE) parts.push("Secure");
  return parts.join("; ");
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const { verifier, challenge } = await generatePKCEPair();
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl(challenge, state);

  const response = NextResponse.redirect(authorizeUrl);
  response.headers.append("Set-Cookie", shortCookie(PKCE_COOKIE, verifier));
  response.headers.append("Set-Cookie", shortCookie(STATE_COOKIE, state));
  return response;
}
