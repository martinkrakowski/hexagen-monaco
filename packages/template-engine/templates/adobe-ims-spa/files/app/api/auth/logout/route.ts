import { NextRequest, NextResponse } from "next/server";
import { AdobeIMSAuthAdapter } from "../../../../src/infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { buildClearTokenCookieHeader } from "../../../../src/infrastructure/auth/adobe-ims/token-store";
import {
  readSessionToken,
  buildClearSessionCookieHeader,
} from "../../../../src/infrastructure/auth/session/session-manager";

const IS_SECURE = process.env.NODE_ENV === "production";
const adapter = new AdobeIMSAuthAdapter();

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const token = readSessionToken(request);

  if (token) {
    try {
      await adapter.revokeSession(token);
    } catch {
      // best-effort — always clear cookies even if IMS revocation fails
    }
  }

  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", buildClearSessionCookieHeader());
  response.headers.append("Set-Cookie", buildClearTokenCookieHeader(IS_SECURE));
  return response;
}
