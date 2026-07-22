"use client";

import React, { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  WizardLifecycleProvider,
  WizardStepFormProvider,
} from "./contexts/WizardLifecycleContext";
import { ResizableLayout } from "./ResizableLayout";
import { GovernancePanelWrapper } from "../governance-assistant/GovernancePanelWrapper";
import { WizardStepRouter } from "../project-wizard/WizardStepRouter";
import { wizardSteps } from "../project-wizard/config";
import { useWorkspaceShellUi } from "./hooks/useWorkspaceShellUi";
import { useEditorSession } from "./hooks/useEditorSession";
import { projectWorkspaceLayoutPropsEqual } from "./project-workspace-layout-equality";
import { ExportProvider } from "@/contexts/ExportContext";
import { SelectedAddOnsProvider } from "../project-wizard/contexts/SelectedAddOnsContext";
import { Header } from "./Header";
import { ArchitecturePreviewPane } from "./ArchitecturePreviewPane";
import { NewProjectConfirmDialog } from "./NewProjectConfirmDialog";
import { UnsavedEditorChangesDialog } from "./UnsavedEditorChangesDialog";
import { ReloadGuard } from "./ReloadGuard";
import {
  EditorGuardProvider,
  useEditorGuard,
} from "@/contexts/EditorGuardContext";
import type { ViewMode } from "@/types/view-mode";
import { PhaseToggle, type WorkspacePhase } from "./plan-phase/PhaseToggle";
import { PlanPhaseView } from "./plan-phase/PlanPhaseView";
import { DerivedFromPlanLink } from "./plan-phase/DerivedFromPlanLink";

export interface ProjectWorkspaceProps {
  currentStepIndex: number;
  viewMode: ViewMode;
  phase: WorkspacePhase;
  onPhaseChange: (phase: WorkspacePhase) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onCloseMiddlePanel: () => void;
  onCloseRightPanel: () => void;
  onGoToStep: (index: number) => void;
  onNavigateToProjects?: () => void;
  children?: React.ReactNode;
}

export function ProjectWorkspace({
  currentStepIndex,
  viewMode,
  phase,
  onPhaseChange,
  onViewModeChange,
  onCloseMiddlePanel,
  onCloseRightPanel,
  onGoToStep,
  onNavigateToProjects,
  children,
}: ProjectWorkspaceProps) {
  const router = useRouter();
  const totalSteps = wizardSteps.length;
  const ui = useWorkspaceShellUi({ currentStepIndex, viewMode });
  const editor = useEditorSession();
  const isEditing = ui.state.kind === "edit";
  const pendingRoute = useRef<string | null>(null);
  // Layers live on the SAVED project only — genesis has nothing for addLayer to
  // target (an unmatched id is a silent no-op), and one dialog path enters edit
  // mode with an empty id, so gate on a real projectId, not just the mode.
  const canUsePlanPhase = ui.state.kind === "edit" && ui.state.projectId !== "";

  return (
    <EditorGuardProvider>
      <WizardLifecycleProvider
        ui={ui}
        uiState={ui.state}
        editor={editor}
        totalSteps={totalSteps}
        onGoToStep={onGoToStep}
      >
        <ProjectWorkspaceLayout
          currentStepIndex={currentStepIndex}
          viewMode={viewMode}
          phase={phase}
          onPhaseChange={onPhaseChange}
          canUsePlanPhase={canUsePlanPhase}
          onViewModeChange={onViewModeChange}
          onCloseMiddlePanel={onCloseMiddlePanel}
          onCloseRightPanel={onCloseRightPanel}
          onNavigateToProjects={onNavigateToProjects}
          ui={ui}
          editor={editor}
          isEditing={isEditing}
          pendingRoute={pendingRoute}
          router={router}
        >
          {children}
        </ProjectWorkspaceLayout>
      </WizardLifecycleProvider>
    </EditorGuardProvider>
  );
}

interface ProjectWorkspaceLayoutProps {
  currentStepIndex: number;
  viewMode: ViewMode;
  phase: WorkspacePhase;
  onPhaseChange: (phase: WorkspacePhase) => void;
  canUsePlanPhase: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onCloseMiddlePanel: () => void;
  onCloseRightPanel: () => void;
  onNavigateToProjects?: () => void;
  ui: ReturnType<typeof useWorkspaceShellUi>;
  editor: ReturnType<typeof useEditorSession>;
  isEditing: boolean;
  pendingRoute: React.RefObject<string | null>;
  router: ReturnType<typeof useRouter>;
  children?: React.ReactNode;
}

const ProjectWorkspaceLayout = React.memo(function ProjectWorkspaceLayout({
  currentStepIndex,
  viewMode,
  phase,
  onPhaseChange,
  canUsePlanPhase,
  onViewModeChange,
  onCloseMiddlePanel,
  onCloseRightPanel,
  onNavigateToProjects,
  ui,
  editor,
  isEditing,
  pendingRoute,
  router,
  children,
}: ProjectWorkspaceLayoutProps) {
  const guard = useEditorGuard();
  const pendingPhase = useRef<WorkspacePhase | null>(null);
  const handleNavigate = useCallback(
    (route: string) => {
      // Unsaved editor (in-buffer) changes take priority — prompt to save them
      // before leaving, since they're the most direct data-loss risk.
      if (guard.hasUnsavedChanges) {
        pendingRoute.current = route;
        ui.openDialog({ kind: "unsaved-editor" });
      } else if (isEditing) {
        pendingRoute.current = route;
        ui.openDialog({ kind: "new-project" });
      } else {
        router.push(route);
      }
    },
    [guard.hasUnsavedChanges, isEditing, ui, router, pendingRoute],
  );

  // Switching phase unmounts the whole 3-pane shell (incl. the Monaco editor,
  // whose in-buffer edits are component-local and lost on unmount) — so it must
  // respect the same unsaved-editor guard as every other shell exit. Only the
  // unsaved-editor branch applies: an in-workspace phase switch is not "leave
  // the project", so the new-project confirm must NOT fire here.
  const handlePhaseChange = useCallback(
    (next: WorkspacePhase) => {
      if (guard.hasUnsavedChanges) {
        pendingPhase.current = next;
        ui.openDialog({ kind: "unsaved-editor" });
      } else {
        onPhaseChange(next);
      }
    },
    [guard.hasUnsavedChanges, ui, onPhaseChange],
  );

  // Whole-shell phase swap: "Plan" replaces the entire 3-pane layout below the
  // Header. Gated on a real saved project (see canUsePlanPhase) — a direct
  // ?phase=plan URL in genesis mode falls back to the Architecture shell.
  const planPhaseActive = phase === "plan" && canUsePlanPhase;

  return (
    <ExportProvider onEditorPushed={editor.clearUnpushed}>
      <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
        <Header
          onLoadManifest={() => handleNavigate("/projects/new/import")}
          isEditing={isEditing}
          onNewProject={() => handleNavigate("/projects/new")}
          onOpenWelcomeManifest={() => handleNavigate("/projects/new/ai")}
          onNavigateToProjects={onNavigateToProjects}
          phaseSlot={
            canUsePlanPhase ? (
              <>
                {/* Provenance affordance: only in Architecture phase, and it
                    subscribes to the lifecycle context itself (no new memo
                    prop). Switches phase on user click only. */}
                {phase === "architecture" && (
                  <DerivedFromPlanLink
                    onNavigateToPlan={() => handlePhaseChange("plan")}
                  />
                )}
                <PhaseToggle phase={phase} onPhaseChange={handlePhaseChange} />
              </>
            ) : undefined
          }
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          {planPhaseActive ? (
            <PlanPhaseView
              onSwitchToArchitecture={() => handlePhaseChange("architecture")}
            />
          ) : (
            <ResizableLayout
              leftTitle="HexaGen Project Wizard"
              rightTitle="AI Governance"
              onRightPanelClose={onCloseRightPanel}
              onLeftPanelClose={onCloseMiddlePanel}
              left={
                <WizardStepFormProvider>
                  <SelectedAddOnsProvider>
                    <WizardStepRouter
                      currentStepIndex={currentStepIndex}
                      totalSteps={wizardSteps.length}
                      onViewModeChange={onViewModeChange}
                      activeContextId={ui.activeContextId ?? ""}
                      activeMappingId={ui.activeMappingId ?? ""}
                      onContextSelect={(id) => ui.setContextId(id)}
                      onMappingSelect={(id) => ui.setMappingId(id)}
                    />
                  </SelectedAddOnsProvider>
                </WizardStepFormProvider>
              }
              middle={
                <ArchitecturePreviewPane
                  viewMode={viewMode}
                  selectedFileId={editor.selectedFileId}
                  editedFiles={editor.editedFiles}
                  unpushed={editor.unpushed}
                  onViewModeChange={onViewModeChange}
                  onFileSelect={editor.selectFile}
                  onFileContentChange={editor.updateFile}
                  onFileSave={editor.markFileSaved}
                  onPushed={editor.clearUnpushed}
                />
              }
              right={
                <GovernancePanelWrapper
                  currentStepIndex={currentStepIndex}
                  enabled={isEditing}
                />
              }
            />
          )}
        </main>

        <NewProjectConfirmDialog
          isOpen={ui.dialog.kind === "new-project"}
          onClose={ui.closeDialog}
          pendingRoute={pendingRoute}
          router={router}
        />

        <ReloadGuard />
        <UnsavedEditorChangesDialog
          isOpen={ui.dialog.kind === "unsaved-editor"}
          onClose={() => {
            pendingRoute.current = null;
            pendingPhase.current = null;
            ui.closeDialog();
          }}
          onProceed={() => {
            const route = pendingRoute.current;
            const nextPhase = pendingPhase.current;
            pendingRoute.current = null;
            pendingPhase.current = null;
            ui.closeDialog();
            if (route) router.push(route);
            // A parked phase switch (never set together with a route).
            if (nextPhase) onPhaseChange(nextPhase);
          }}
        />
      </div>
      {children}
    </ExportProvider>
  );
}, projectWorkspaceLayoutPropsEqual);
