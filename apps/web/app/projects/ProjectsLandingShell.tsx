"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { useLocalLLM } from "@/llm-driver/useLocalLlm";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import { useManifestImport } from "@/workspace-shell/hooks/useManifestImport";
import { WelcomeManifestDialog } from "@/workspace-shell/WelcomeManifestDialog";
import { LoadManifestDialog } from "@/workspace-shell/LoadManifestDialog";
import { ProjectsLandingHeader } from "@/landing/ProjectsLandingHeader";
import { ProjectCardGrid } from "@/landing/ProjectCardGrid";

function deriveProjectName(yamlContent: string): string {
  const match = yamlContent.match(/^system:\s*(.+)$/m);
  if (match?.[1]) {
    const raw = match[1].trim().replace(/^["']|["']$/g, "");
    if (raw) {
      return raw.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return "AI Generated Project";
}

export function ProjectsLandingShell() {
  const router = useRouter();
  const llmContext = useLocalLLM();
  const { projects, isLoading, saveProject, deleteProject, renameProject } =
    useSavedProjects();
  const { importManifest } = useManifestImport();

  const [welcomeDialogOpen, setWelcomeDialogOpen] = useState(false);
  const [loadManifestDialogOpen, setLoadManifestDialogOpen] = useState(false);

  const routeToWizard = useCallback(
    (projectId: string) => {
      router.push(`/wizard/1?project=${encodeURIComponent(projectId)}`);
    },
    [router],
  );

  const handleUseManifest = useCallback(
    async (yamlContent: string) => {
      const outcome = await importManifest(yamlContent);
      if (outcome.kind === "success") {
        const name = deriveProjectName(yamlContent);
        const projectId = saveProject(name, outcome.formValues, yamlContent);
        setWelcomeDialogOpen(false);
        routeToWizard(projectId);
      } else {
        window.alert(
          outcome.message ||
            "Failed to parse the generated manifest. Please try regenerating.",
        );
      }
    },
    [importManifest, saveProject, routeToWizard],
  );

  const handleFileLoaded = useCallback(
    async (yamlContent: string) => {
      const outcome = await importManifest(yamlContent);
      if (outcome.kind === "success") {
        const name = deriveProjectName(yamlContent);
        const projectId = saveProject(name, outcome.formValues, yamlContent);
        setLoadManifestDialogOpen(false);
        routeToWizard(projectId);
      } else {
        window.alert(
          outcome.message ||
            "Failed to parse the manifest file. Please check the format.",
        );
      }
    },
    [importManifest, saveProject, routeToWizard],
  );

  const handleLoadProject = useCallback(
    (id: string) => {
      routeToWizard(id);
    },
    [routeToWizard],
  );

  const handleStartWizard = useCallback(() => {
    router.push("/wizard/1");
  }, [router]);

  const handleNewProject = useCallback(() => {
    if (projects.length === 0) {
      setWelcomeDialogOpen(true);
    } else {
      setWelcomeDialogOpen(true);
    }
  }, [projects.length]);

  return (
    <div className="flex flex-col min-h-screen">
      <ProjectsLandingHeader onNewProject={handleNewProject} />

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
            onOpenWelcomeDialog={() => setWelcomeDialogOpen(true)}
            onImportManifest={() => setLoadManifestDialogOpen(true)}
            onStartWizard={handleStartWizard}
          />
        )}
      </main>

      <WelcomeManifestDialog
        open={welcomeDialogOpen}
        onClose={() => setWelcomeDialogOpen(false)}
        onUseManifest={handleUseManifest}
        llmContext={llmContext}
        onImportManifest={() => {
          setWelcomeDialogOpen(false);
          setLoadManifestDialogOpen(true);
        }}
        onStartWizard={() => {
          setWelcomeDialogOpen(false);
          handleStartWizard();
        }}
        onLoadProject={handleLoadProject}
      />

      <LoadManifestDialog
        open={loadManifestDialogOpen}
        onClose={() => setLoadManifestDialogOpen(false)}
        onFileLoaded={handleFileLoaded}
      />
    </div>
  );
}
