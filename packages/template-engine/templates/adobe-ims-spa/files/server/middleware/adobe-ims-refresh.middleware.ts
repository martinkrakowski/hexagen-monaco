import { NextRequest, NextResponse } from "next/server";
import { IMSClient } from "../../src/infrastructure/auth/adobe-ims/ims-client";
import { AdobeIMSAuthAdapter } from "../../src/infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { decryptTokens, buildTokenCookieHeader, buildClearTokenCookieHeader } from "../../src/infrastructure/auth/adobe-ims/token-store";
import { IMS_CONFIG } from "../../src/infrastructure/auth/adobe-ims/config";
import {
  readSessionToken,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
} from "../../src/infrastructure/auth/session/session-manager";

const IS_SECURE = process.env.NODE_ENV === "production";
const imsClient = new IMSClient();
const adapter = new AdobeIMSAuthAdapter();

/**
 * Auto-refresh middleware for Adobe IMS tokens.
 * Run this BEFORE authMiddleware in your root middleware.ts.
 *
 * If the access token is within 300s of expiry, silently refreshes it,
 * re-encrypts, and sets updated cookies on the response.
 * On refresh failure, clears all session/token cookies and returns 401.
 *
 * Usage in middleware.ts:
 *   import { adobeIMSRefreshMiddleware } from "./server/middleware/adobe-ims-refresh.middleware";
 *   export default adobeIMSRefreshMiddleware;
 */
export async function adobeIMSRefreshMiddleware(request: NextRequest): Promise<NextResponse> {
  if (!IMS_CONFIG.autoRefresh) return NextResponse.next();

  const sessionToken = readSessionToken(request);
  if (!sessionToken) return NextResponse.next();

  const tokens = await decryptTokens(sessionToken);
  if (!tokens) return NextResponse.next();

  const needsRefresh = tokens.expiresAt - Date.now() < IMS_CONFIG.refreshWindowSeconds * 1000;
  if (!needsRefresh) return NextResponse.next();

  if (!tokens.refreshToken) {
    const response = NextResponse.json({ error: "Session expired" }, { status: 401 });
    response.headers.append("Set-Cookie", buildClearSessionCookieHeader());
    response.headers.append("Set-Cookie", buildClearTokenCookieHeader(IS_SECURE));
    return response;
  }

  try {
    const refreshed = await imsClient.refreshToken(tokens.refreshToken);
    const newSessionToken = await adapter.createSessionFromTokens(refreshed);

    const response = NextResponse.next();
    response.headers.append("Set-Cookie", buildSessionCookieHeader(newSessionToken));
    response.headers.append("Set-Cookie", buildTokenCookieHeader(newSessionToken, IS_SECURE));
    return response;
  } catch {
    const response = NextResponse.json({ error: "Session refresh failed" }, { status: 401 });
    response.headers.append("Set-Cookie", buildClearSessionCookieHeader());
    response.headers.append("Set-Cookie", buildClearTokenCookieHeader(IS_SECURE));
    return response;
  }
}
