import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { UserContext } from "./src/domain/value-objects/user-context";
import { MOCK_USER } from "./src/infrastructure/auth/mock-user";

// Root middleware: honours AUTH_MODE=mock as a dev short-circuit, then runs
// Supabase's standard SSR session-refresh pattern. The refresh MUST happen
// between createServerClient and getUser — do not add work in between.
const PROTECTED_PATHS = "{protected_paths}"
  .split(",")
  .map((p) => p.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

interface SupabaseUserShape {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

function mapSupabaseUserToUserContext(user: SupabaseUserShape): UserContext {
  const meta = (user.user_metadata ?? {}) as {
    name?: string;
    full_name?: string;
    avatar_url?: string;
  };
  return {
    id: user.id,
    email: user.email ?? "",
    name: meta.full_name ?? meta.name ?? user.email ?? user.id,
    roles: ["user"],
    avatarUrl: meta.avatar_url,
  };
}

export default async function middleware(request: NextRequest) {
  if (process.env.AUTH_MODE === "mock") {
    const headers = new Headers(request.headers);
    headers.set("x-user-context", JSON.stringify(MOCK_USER));
    return NextResponse.next({ request: { headers } });
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (isProtected(pathname) && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user) {
    response.headers.set(
      "x-user-context",
      JSON.stringify(mapSupabaseUserToUserContext(user)),
    );
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
