import { NextRequest, NextResponse } from "next/server";
import { authService, MOCK_USER } from "../../../../src/infrastructure/auth";
import { readSessionToken } from "../../../../src/infrastructure/auth/session/session-manager";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = readSessionToken(request);

  if (!token) {
    if (process.env.AUTH_MODE !== "real") {
      return NextResponse.json(MOCK_USER);
    }
    return NextResponse.json({ error: "No active session" }, { status: 401 });
  }

  const user = await authService.getCurrentUser(token);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  return NextResponse.json(user);
}
