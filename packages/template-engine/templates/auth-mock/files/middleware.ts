import { NextResponse, type NextRequest } from "next/server";
import { MOCK_USER } from "./src/infrastructure/auth/mock-user";

// Dev-only root middleware: when AUTH_MODE=mock, every request is treated as
// signed in as MOCK_USER (exposed downstream via the x-user-context header).
// When AUTH_MODE is anything else, this is a no-op pass-through.
//
// A real auth provider template (google-oauth, supabase, etc.) overwrites this
// file with its own middleware that validates the provider's session and still
// honours AUTH_MODE=mock as a dev short-circuit.
export default function middleware(request: NextRequest) {
  if (process.env.AUTH_MODE !== "mock") {
    return NextResponse.next();
  }
  const headers = new Headers(request.headers);
  headers.set("x-user-context", JSON.stringify(MOCK_USER));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
