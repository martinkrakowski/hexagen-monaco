import { ReactNode } from "react";

interface WelcomeScreenLayoutProps {
  children: ReactNode;
}

export function WelcomeScreenLayout({ children }: WelcomeScreenLayoutProps) {
  return <div className="flex flex-col space-y-4 pb-6">{children}</div>;
}
