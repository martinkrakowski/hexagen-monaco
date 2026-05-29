import NextAuth from "next-auth";
import authConfig from "./src/auth.config";

// Edge middleware runs only the Edge-safe config (no DB adapter, no Node providers).
// Route access is decided by the `authorized` callback in src/auth.config.ts.
export const { auth } = NextAuth(authConfig);

export default auth((req) => {
  void req;
});

export const config = {
  // Match all routes except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",
  ],
};
