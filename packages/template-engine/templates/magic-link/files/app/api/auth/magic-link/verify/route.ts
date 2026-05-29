import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "../../../../../src/infrastructure/auth/magic-link/token-generator";
import { consumeToken } from "../../../../../src/infrastructure/auth/magic-link/magic-link-store";
import { mapEmailToUserContext } from "../../../../../src/infrastructure/auth/magic-link/user-profile-mapper";
import { MagicLinkAuthAdapter } from "../../../../../src/infrastructure/auth/magic-link/magic-link-auth.adapter";
import { buildSessionCookieHeader } from "../../../../../src/infrastructure/auth/session/session-manager";

const adapter = new MagicLinkAuthAdapter();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(
      new URL("/login?error=Missing+token", request.url),
    );
  }

  const payload = await verifyToken(token);

  if (!payload) {
    return NextResponse.redirect(
      new URL("/login?error=Invalid+or+expired+magic+link", request.url),
    );
  }

  // Extract the signature (last segment) as the uniqueness key for replay protection
  const signature = token.slice(token.lastIndexOf(".") + 1);
  if (!consumeToken(signature)) {
    return NextResponse.redirect(
      new URL("/login?error=Magic+link+already+used", request.url),
    );
  }

  const user = mapEmailToUserContext(payload.email);
  const sessionToken = await adapter.createSession(user);

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.headers.append("Set-Cookie", buildSessionCookieHeader(sessionToken));
  return response;
}
