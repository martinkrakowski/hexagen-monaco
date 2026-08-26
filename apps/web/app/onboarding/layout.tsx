"use client";

import { WorkspaceChrome } from "@/workspace-shell/WorkspaceChrome";

// The onboarding wizard renders inside the SAME application shell as
// /projects and /login — that identity is the point of WorkspaceChrome.
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceChrome>{children}</WorkspaceChrome>;
}
