import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

// Path prefixes that require an authenticated session (from the `protected_paths` answer).
const PROTECTED_PATHS = "{protected_paths}"
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

// Edge-safe configuration shared between the middleware and the full auth instance.
// Only OAuth providers and the `authorized` callback live here — no database adapter
// and no Node-only providers (e.g. Credentials with bcrypt), which belong in auth.ts.
export default {
  trustHost: "{trust_host}" === "true",
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    // Used by middleware to gate protected routes without importing Node-only code.
    authorized({ request, auth }) {
      const { pathname } = request.nextUrl;
      const isProtected = PROTECTED_PATHS.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      );
      if (!isProtected) return true;
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
