"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { projectMode } from "@hexagen/shared";
import type { WorkspacePhase } from "../../features/workspace-shell/plan-phase/PhaseToggle";

import { ProjectWorkspace } from "../../features/workspace-shell/ProjectWorkspace";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { wizardSteps } from "../../features/project-wizard/config";
import type { ViewMode } from "../../types/view-mode";

import { usePanelToggle } from "../../features/workspace-shell/hooks/usePanelToggle";
import { useStepNavigation } from "../../features/workspace-shell/hooks/useStepNavigation";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { useSavedProjects } from "@/hooks/useSavedProjects";

/**
 * How the `?project=` id resolved against the saved projects.
 *  - "loading":    a URL id is present and the saved projects are not loaded.
 *  - "brownfield": the id is a brownfield workbook (BW-D7): redirected away.
 *  - "missing":    a URL id that matches no saved project (existing handling).
 *  - "ready":      no URL id, or a greenfield project.
 */
type ProjectResolution = "loading" | "brownfield" | "missing" | "ready";

function useProjectSearchParam(): ProjectResolution {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeWorkspace, setActiveWorkspace } = useActiveWorkspace();
  const { projects, isLoading } = useSavedProjects();

  const activeWorkspaceRef = useRef(activeWorkspace);
  activeWorkspaceRef.current = activeWorkspace;

  const projectId = searchParams.get("project");

  const saved = projectId
    ? projects.find((p) => p.id === projectId)
    : undefined;
  let resolution: ProjectResolution = "ready";
  if (projectId) {
    if (isLoading) resolution = "loading";
    else if (!saved) resolution = "missing";
    else if (projectMode(saved) === "brownfield") resolution = "brownfield";
  }

  useEffect(() => {
    if (!projectId) return;
    if (isLoading) return;
    if (projects.length === 0) return;

    const target = projects.find((p) => p.id === projectId);
    if (!target) return;

    // BW-D7: a brownfield workbook never becomes the active workspace of the
    // greenfield shell; send it to its own viewer instead. This check runs
    // BEFORE the same-id shortcut below, so an already-active workspace with
    // this id cannot skip it.
    if (projectMode(target) === "brownfield") {
      router.replace(
        `/projects/brownfield?project=${encodeURIComponent(target.id)}`,
      );
      return;
    }

    if (activeWorkspaceRef.current?.projectId === projectId) return;

    setActiveWorkspace({
      projectId: target.id,
      name: target.name,
      isDirty: false,
      lastModifiedAt: Date.now(),
      wizardData: { ...target.formState },
      manifestYaml: target.manifestYaml,
    });
  }, [projectId, isLoading, projects, setActiveWorkspace, router]);

  return resolution;
}

function WizardLayoutInner({ children }: { children: React.ReactNode }) {
  const params = useParams<{ step: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const resolution = useProjectSearchParam();

  const stepParam = /^\d+$/.test(params.step) ? Number(params.step) : NaN;
  const currentStepIndex =
    Number.isNaN(stepParam) || stepParam < 1 || stepParam > wizardSteps.length
      ? 0
      : stepParam - 1;

  const viewMode: ViewMode =
    searchParams.get("view") === "code" ? "code" : "visual";
  // The workspace phase survives reload/back via the URL, like ?view=code.
  const phase: WorkspacePhase =
    searchParams.get("phase") === "plan" ? "plan" : "architecture";

  const viewToggle = usePanelToggle("view");
  const middleToggle = usePanelToggle("middle");
  const rightToggle = usePanelToggle("right");
  // Destructure the memoized fns: usePanelToggle returns a fresh object every
  // render, and onPhaseChange feeds the layout's React.memo comparator — an
  // object dep would re-mint the callback per render and defeat the memo.
  const { toggle: setPhaseParam, close: clearPhaseParam } =
    usePanelToggle("phase");
  const stepNav = useStepNavigation(currentStepIndex);

  const onPhaseChange = useCallback(
    (next: WorkspacePhase) => {
      if (next === phase) return;
      // "architecture" is the default → represented by the param's absence.
      // toggle() is safe here: the early-return guarantees the param isn't
      // already "plan", so it always sets rather than clears.
      if (next === "plan") setPhaseParam("plan");
      else clearPhaseParam();
    },
    [phase, setPhaseParam, clearPhaseParam],
  );

  // While a URL id is unresolved, or once it resolves as a brownfield workbook
  // (the effect is redirecting), mount NEITHER the workspace shell nor the
  // wizard children: the greenfield shell must never render for a workbook.
  if (resolution === "loading" || resolution === "brownfield") {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center text-muted-foreground"
      >
        Loading project...
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ProjectWorkspace
        currentStepIndex={currentStepIndex}
        viewMode={viewMode}
        phase={phase}
        onPhaseChange={onPhaseChange}
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
