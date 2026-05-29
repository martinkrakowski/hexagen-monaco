import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// Server component layout for the (protected) route group: redirects to the
// Clerk sign-in page when there is no active session. Clerk's hosted UI renders
// the sign-in screen, so no login page is generated here.
export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  return children;
}
