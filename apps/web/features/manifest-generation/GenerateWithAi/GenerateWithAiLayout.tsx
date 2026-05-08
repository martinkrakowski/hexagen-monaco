import { ReactNode } from "react";

interface GenerateWithAiLayoutProps {
  children: ReactNode;
}

export function GenerateWithAiLayout({ children }: GenerateWithAiLayoutProps) {
  return <div className="flex flex-col space-y-4 pb-6">{children}</div>;
}
