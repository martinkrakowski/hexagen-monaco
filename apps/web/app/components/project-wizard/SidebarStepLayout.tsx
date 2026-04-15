import { ReactNode } from "react";

interface SidebarStepLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function SidebarStepLayout({
  sidebar,
  children,
}: SidebarStepLayoutProps) {
  return (
    <div className="flex flex-col h-full w-full">
      <div className="shrink-0 border-b border-border">{sidebar}</div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
