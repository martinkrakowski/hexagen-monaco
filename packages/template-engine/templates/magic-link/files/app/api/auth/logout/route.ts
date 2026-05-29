import { NextRequest, NextResponse } from "next/server";
import {
  readSessionToken,
  buildClearSessionCookieHeader,
} from "../../../../src/infrastructure/auth/session/session-manager";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  void readSessionToken(request); // no server-side state to clean up
  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", buildClearSessionCookieHeader());
  return response;
}
