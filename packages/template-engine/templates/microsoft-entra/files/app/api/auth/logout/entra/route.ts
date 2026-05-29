import { NextRequest, NextResponse } from "next/server";
import { ENTRA_CONFIG } from "../../../../../src/infrastructure/auth/entra/config";
import {
  readSessionToken,
  buildClearSessionCookieHeader,
} from "../../../../../src/infrastructure/auth/session/session-manager";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const token = readSessionToken(request);

  // Clear the local session cookie first
  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", buildClearSessionCookieHeader());

  // Optionally redirect to Entra front-channel logout if token exists
  // Uncomment to force single-sign-out across all Entra-integrated apps:
  //
  // if (token) {
  //   const logoutUrl = `https://login.microsoftonline.com/${ENTRA_CONFIG.tenantId}/oauth2/v2.0/logout` +
  //     `?post_logout_redirect_uri=${encodeURIComponent(ENTRA_CONFIG.redirectUri.replace("/callback/entra", ""))}`;
  //   return NextResponse.redirect(logoutUrl);
  // }

  void token; // suppress unused warning when front-channel logout is commented out
  return response;
}
