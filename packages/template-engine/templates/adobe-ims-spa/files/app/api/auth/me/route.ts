import { NextResponse } from "next/server";
import { getValidatedSession } from "../../../../src/lib/auth/get-current-user";
import { buildSessionCookieHeader } from "../../../../src/infrastructure/auth/session/session-manager";

export async function GET() {
  const session = await getValidatedSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const response = NextResponse.json({ user: session.user });
  if (session.refreshedToken) {
    response.headers.append(
      "Set-Cookie",
      buildSessionCookieHeader(session.refreshedToken),
    );
  }
  return response;
}
