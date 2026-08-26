"use client";

import { WorkspaceChrome } from "@/workspace-shell/WorkspaceChrome";

// /login lives outside the /projects segment but renders inside the SAME
// application shell — that identity is the point of WorkspaceChrome.
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceChrome>{children}</WorkspaceChrome>;
}
