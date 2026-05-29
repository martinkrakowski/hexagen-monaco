import { NextRequest, NextResponse } from "next/server";
import { AdobeIMSAuthAdapter } from "../../../../src/infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import {
  readSessionToken,
  buildClearSessionCookieHeader,
} from "../../../../src/infrastructure/auth/session/session-manager";

const adapter = new AdobeIMSAuthAdapter();

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const token = readSessionToken(request);

  if (token) {
    try {
      await adapter.revokeSession(token);
    } catch {
      // best-effort — always clear the cookie even if IMS revocation fails
    }
  }

  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", buildClearSessionCookieHeader());
  return response;
}
