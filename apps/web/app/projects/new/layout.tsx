import React from "react";

export default function NewProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border bg-background">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-lg font-semibold">Create New Project</h1>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-6 py-12">{children}</main>
    </div>
  );
}
