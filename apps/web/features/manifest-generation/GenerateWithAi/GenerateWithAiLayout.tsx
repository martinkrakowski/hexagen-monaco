import { ReactNode } from "react";

interface GenerateWithAiLayoutProps {
  children: ReactNode;
}

export function GenerateWithAiLayout({ children }: GenerateWithAiLayoutProps) {
  return (
    <div className="h-full w-full dot-grid">
      <div className="flex items-center justify-center min-h-full py-12 px-6">
        <div className="max-w-2xl mx-auto px-6 w-full space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
}
