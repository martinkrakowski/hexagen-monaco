import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";

// Example protected API route. clerkMiddleware already gates matched routes;
// this also shows minting a JWT-template token to authenticate a downstream
// service that Clerk does not own (e.g. an external API).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { userId, getToken } = getAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Token shaped by the "{jwt_template}" JWT template configured in the Clerk dashboard.
  const token = await getToken({ template: "{jwt_template}" });

  return NextResponse.json({ userId, token });
}
