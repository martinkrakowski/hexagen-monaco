"use client";

import { Suspense, useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

import { ProjectWorkspace } from "../../features/workspace-shell/ProjectWorkspace";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { wizardSteps } from "../../features/project-wizard/config";
import type { ViewMode } from "../../types/view-mode";

import { usePanelToggle } from "../../features/workspace-shell/hooks/usePanelToggle";
import { useStepNavigation } from "../../features/workspace-shell/hooks/useStepNavigation";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { useSavedProjects } from "@/hooks/useSavedProjects";

function useProjectSearchParam() {
  const searchParams = useSearchParams();
  const { activeWorkspace, setActiveWorkspace } = useActiveWorkspace();
  const { projects, loadProject } = useSavedProjects();

  const projectId = searchParams.get("project");

  useEffect(() => {
    if (!projectId) return;
    if (activeWorkspace?.projectId === projectId) return;
    if (projects.length === 0) return;

    const saved = loadProject(projectId);
    if (saved) {
      setActiveWorkspace({
        projectId: saved.id,
        name: saved.name,
        isDirty: false,
        lastModifiedAt: Date.now(),
        wizardData: { ...saved.formState },
        manifestYaml: saved.manifestYaml,
      });
    }
  }, [
    projectId,
    activeWorkspace,
    setActiveWorkspace,
    loadProject,
    projects.length,
  ]);
}

function WizardLayoutInner({ children }: { children: React.ReactNode }) {
  const params = useParams<{ step: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  useProjectSearchParam();

  const stepParam = parseInt(params.step, 10);
  const currentStepIndex = Number.isNaN(stepParam)
    ? 0
    : Math.max(0, Math.min(stepParam - 1, wizardSteps.length - 1));

  const viewMode: ViewMode =
    searchParams.get("view") === "code" ? "code" : "visual";

  const middlePanel = searchParams.get("middle") ?? undefined;
  const rightPanel = searchParams.get("right") ?? undefined;

  const viewToggle = usePanelToggle("view");
  const middleToggle = usePanelToggle("middle");
  const rightToggle = usePanelToggle("right");
  const stepNav = useStepNavigation(currentStepIndex);

  return (
    <ErrorBoundary>
      <ProjectWorkspace
        currentStepIndex={currentStepIndex}
        viewMode={viewMode}
        middlePanel={middlePanel}
        rightPanel={rightPanel}
        onViewModeChange={(mode: ViewMode) => viewToggle.toggle(mode)}
        onCloseMiddlePanel={middleToggle.close}
        onCloseRightPanel={rightToggle.close}
        onGoToStep={stepNav.goToStep}
        onNavigateToProjects={() => router.push("/projects")}
      >
        {children}
      </ProjectWorkspace>
    </ErrorBoundary>
  );
}

export default function WizardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense>
      <WizardLayoutInner>{children}</WizardLayoutInner>
    </Suspense>
  );
}
