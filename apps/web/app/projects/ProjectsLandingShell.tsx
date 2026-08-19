"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useSavedProjects } from "@/hooks/useSavedProjects";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { ProjectCardGrid } from "@/landing/ProjectCardGrid";
import { ProjectsShell } from "@/ProjectsShell";
import Link from "next/link";
import { Button } from "@hexagen/ui";
import { Plus } from "lucide-react";

function LoadingSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-5 w-5 rounded bg-muted animate-shimmer" />
          <div className="h-4 w-48 rounded bg-muted animate-shimmer" />
          <div className="h-4 w-24 rounded bg-muted animate-shimmer hidden lg:block" />
          <div className="h-4 w-12 rounded bg-muted animate-shimmer hidden sm:block" />
          <div className="h-4 w-16 rounded bg-muted animate-shimmer hidden xl:block" />
          <div className="h-4 w-16 rounded bg-muted animate-shimmer hidden xl:block" />
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
    <ProjectsShell
      title="Projects"
      footer={
        <>
          <div className="flex flex-wrap gap-2">
            <Link href="/projects/history">
              <Button variant="outline" size="sm">
                Run history
              </Button>
            </Link>
            <Link href="/auth/signin">
              <Button variant="outline" size="sm">
                Sign in
              </Button>
            </Link>
          </div>
          <Link href="/projects/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </Link>
        </>
      }
    >
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
    </ProjectsShell>
  );
}
