"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/workspace-shell/Header";
import { ExportProvider } from "@/contexts/ExportContext";

/**
 * The application chrome — topbar plus the padded main region — extracted
 * from app/projects/layout.tsx so routes OUTSIDE /projects (today: /login)
 * can render inside the identical shell rather than a lookalike. Both route
 * layouts are thin wrappers over this component; if the chrome needs to
 * change, it changes here once.
 */
export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <ExportProvider>
      <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
        <Header
          onLoadManifest={() => router.push("/projects/new/import")}
          onNewProject={() => router.push("/projects/new")}
          onOpenWelcomeManifest={() => router.push("/projects/new/ai")}
          onNavigateToProjects={() => router.push("/projects")}
        />
        <main className="flex-1 overflow-hidden p-4">{children}</main>
      </div>
    </ExportProvider>
  );
}
