"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useCallback } from "react";

import { useLocalLLM } from "@/llm-driver/useLocalLlm";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import { WelcomeManifestDialog } from "@/workspace-shell/WelcomeManifestDialog";

function ProjectsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const showWelcome = searchParams.get("welcome") === "true";

  const llmContext = useLocalLLM();
  const { projects } = useSavedProjects();

  const handleCloseWelcome = useCallback(() => {
    router.replace("/projects");
  }, [router]);

  return (
    <div>
      <h1>Projects</h1>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>
      <WelcomeManifestDialog
        open={showWelcome}
        onClose={handleCloseWelcome}
        onUseManifest={() => {}}
        llmContext={llmContext}
        onImportManifest={() => {}}
        onStartWizard={() => {}}
        onLoadProject={() => {}}
      />
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsPageInner />
    </Suspense>
  );
}
