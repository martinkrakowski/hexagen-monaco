import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../src/lib/auth/get-current-user";

// Returns the current UserContext (or 401). Server-side, but useful when a
// client component wants to bootstrap auth state without a Server Component
// boundary.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ user });
}
