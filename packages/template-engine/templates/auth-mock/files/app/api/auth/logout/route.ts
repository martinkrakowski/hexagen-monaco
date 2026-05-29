import { NextRequest, NextResponse } from "next/server";
import { authService } from "../../../../src/infrastructure/auth";
import {
  readSessionToken,
  buildClearSessionCookieHeader,
} from "../../../../src/infrastructure/auth/session/session-manager";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const token = readSessionToken(request);

  if (token) {
    await authService.revokeSession(token);
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", buildClearSessionCookieHeader());
  return response;
}
