import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Route prefixes that require an authenticated session (from the `protected_paths` answer).
const isProtectedRoute = createRouteMatcher(
  "{protected_paths}"
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p + "(.*)"),
);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
