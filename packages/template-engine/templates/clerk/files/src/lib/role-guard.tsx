"use client";

import type { ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";

interface RoleGuardProps {
  role: string;
  /** Check the Clerk organisation role (useAuth().orgRole) instead of the app-level role. */
  org?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}

// Renders children only when the signed-in user holds the required role.
// org=true gates on the Clerk organisation role; otherwise on the custom
// app-level role in sessionClaims.metadata.role.
export function RoleGuard({
  role,
  org = false,
  fallback = null,
  children,
}: RoleGuardProps): ReactNode {
  const { isLoaded, orgRole, sessionClaims } = useAuth();

  if (!isLoaded) return null;

  const appRole = (sessionClaims?.metadata as { role?: string } | undefined)
    ?.role;
  const hasRole = org ? orgRole === role : appRole === role;

  return hasRole ? children : fallback;
}
