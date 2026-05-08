"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { useSavedProjects } from "@/hooks/useSavedProjects";
import { ProjectsLandingHeader } from "@/landing/ProjectsLandingHeader";
import { ProjectCardGrid } from "@/landing/ProjectCardGrid";

export function ProjectsLandingShell() {
  const router = useRouter();
  const { projects, isLoading, deleteProject, renameProject } =
    useSavedProjects();

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
    <div className="flex flex-col min-h-screen">
      <ProjectsLandingHeader />

      <main className="flex-1 container mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center text-muted-foreground">
              Loading projects...
            </div>
          </div>
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
  );
}
