import { NextRequest, NextResponse } from "next/server";
import { authService } from "../../../../src/infrastructure/auth";
import {
  readSessionToken,
  buildClearSessionCookieHeader,
} from "../../../../src/infrastructure/auth/session/session-manager";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const token = readSessionToken(request);

  if (token) {
    try {
      await authService.revokeSession(token);
    } catch {
      // best-effort — always clear the cookie even if revocation fails
    }
  }

  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", buildClearSessionCookieHeader());
  return response;
}
