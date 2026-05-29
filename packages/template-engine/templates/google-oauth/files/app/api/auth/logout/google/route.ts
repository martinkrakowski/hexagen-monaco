import { NextResponse } from "next/server";
import { buildClearSessionCookieHeader } from "../../../../../src/infrastructure/auth/session/session-manager";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", buildClearSessionCookieHeader());
  return response;
}
