"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useSavedProjects } from "@/hooks/useSavedProjects";
import { Header } from "@/workspace-shell/Header";
import { ExportProvider } from "@/contexts/ExportContext";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { ProjectCardGrid } from "@/landing/ProjectCardGrid";

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-5 w-5 rounded bg-muted animate-shimmer" />
          <div className="h-4 w-48 rounded bg-muted animate-shimmer" />
          <div className="h-4 w-24 rounded bg-muted animate-shimmer hidden md:block" />
          <div className="h-4 w-24 rounded bg-muted animate-shimmer hidden lg:block" />
        </div>
      ))}
    </div>
  );
}

export function ProjectsLandingShell() {
  const router = useRouter();
  const { projects, isLoading, deleteProject, renameProject } =
    useSavedProjects();
  const { clearActiveWorkspace } = useActiveWorkspace();

  useEffect(() => {
    clearActiveWorkspace();
  }, [clearActiveWorkspace]);

  const routeToWizard = useCallback(
    (projectId: string) => {
      router.push(`/wizard/1?project=${encodeURIComponent(projectId)}`);
    },
    [router],
  );

  const handleLoadProject = useCallback(
    (id: string) => {
      routeToWizard(id);
    },
    [routeToWizard],
  );

  return (
    <ExportProvider>
      <div className="flex flex-col min-h-screen">
        <Header
          onLoadManifest={() => router.push("/projects/new/import")}
          onNewProject={() => router.push("/projects/new")}
          onOpenWelcomeManifest={() => router.push("/projects/new/ai")}
        />

        <main className="flex-1 container mx-auto px-6 py-8">
          {isLoading ? (
            <LoadingSkeleton />
          ) : (
            <ProjectCardGrid
              projects={projects}
              onLoadProject={handleLoadProject}
              onDeleteProject={deleteProject}
              onRenameProject={renameProject}
            />
          )}
        </main>
      </div>
    </ExportProvider>
  );
}
