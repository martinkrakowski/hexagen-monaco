import { auth, currentUser } from "@clerk/nextjs/server";

// Single import surface for Clerk's server-side auth helpers.
export { auth, currentUser };

// Resolve the custom app-level role from session claims metadata
// (set via Clerk dashboard → Sessions → custom claims, or publicMetadata).
export async function getCurrentRole(): Promise<string | null> {
  const { sessionClaims } = await auth();
  const metadata = sessionClaims?.metadata as { role?: string } | undefined;
  return metadata?.role ?? null;
}
