import { NextRequest, NextResponse } from "next/server";
import { AdobeIMSAuthAdapter } from "../../../../src/infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { readSessionToken } from "../../../../src/infrastructure/auth/session/session-manager";

const adapter = new AdobeIMSAuthAdapter();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = readSessionToken(request);

  if (!token) {
    return NextResponse.json({ error: "No active session" }, { status: 401 });
  }

  const user = await adapter.validate(token);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  return NextResponse.json(user);
}
