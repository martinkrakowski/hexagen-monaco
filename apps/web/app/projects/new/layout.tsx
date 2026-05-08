"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/workspace-shell/Header";
import { ExportProvider } from "@/contexts/ExportContext";

export default function NewProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <ExportProvider>
      <div className="flex flex-col min-h-screen">
        <Header
          onLoadManifest={() => router.push("/projects/new/import")}
          onNewProject={() => router.push("/projects/new")}
          onOpenWelcomeManifest={() => router.push("/projects/new/ai")}
          onNavigateToProjects={() => router.push("/projects")}
        />

        <main className="flex-1 container mx-auto px-6 py-12">{children}</main>
      </div>
    </ExportProvider>
  );
}
