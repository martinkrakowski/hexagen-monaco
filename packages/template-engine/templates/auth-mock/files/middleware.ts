import { NextResponse, type NextRequest } from "next/server";
import { MOCK_USER } from "./src/infrastructure/auth/mock-user";

// Dev-only root middleware: when AUTH_MODE=mock, every request is treated as
// signed in as MOCK_USER (exposed downstream via the x-user-context header).
// When AUTH_MODE is anything else, this is a pass-through that still strips
// any client-supplied x-user-context header so downstream getCurrentUser()
// helpers can safely trust the header when present.
//
// A real auth provider template (google-oauth, supabase, etc.) overwrites this
// file with its own middleware that validates the provider's session, still
// honours AUTH_MODE=mock as a dev short-circuit, and applies the same strip.
export default function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("x-user-context");

  if (process.env.AUTH_MODE === "mock") {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("AUTH_MODE=mock is only supported in development");
    }
    headers.set("x-user-context", JSON.stringify(MOCK_USER));
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
