import { ReactNode } from "react";

interface WelcomeScreenLayoutProps {
  children: ReactNode;
}

export function WelcomeScreenLayout({ children }: WelcomeScreenLayoutProps) {
  return <div>{children}</div>;
}
