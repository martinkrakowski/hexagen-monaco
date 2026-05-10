"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { WizardLifecycleProvider } from "./contexts/WizardLifecycleContext";
import { ResizableLayout } from "./ResizableLayout";
import { GovernancePanelWrapper } from "../governance-assistant/GovernancePanelWrapper";
import { WizardStepRouter } from "../project-wizard/WizardStepRouter";
import { wizardSteps } from "../project-wizard/config";
import { useWorkspaceShellUi } from "./hooks/useWorkspaceShellUi";
import { useEditorSession } from "./hooks/useEditorSession";
import { ExportProvider } from "@/contexts/ExportContext";
import { Header } from "./Header";
import { ArchitecturePreviewPane } from "./ArchitecturePreviewPane";
import { NewProjectConfirmDialog } from "./NewProjectConfirmDialog";
import type { ViewMode } from "@/types/view-mode";

export interface ProjectWorkspaceProps {
  currentStepIndex: number;
  viewMode: ViewMode;
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

  const navigateWithConfirm = useCallback(
    (route: string) => {
      if (isEditing) {
        pendingRoute.current = route;
        ui.openDialog({ kind: "new-project" });
      } else {
        router.push(route);
      }
    },
    [isEditing, ui, router],
  );

  return (
    <WizardLifecycleProvider
      ui={ui}
      uiState={ui.state}
      editor={editor}
      totalSteps={totalSteps}
      onGoToStep={onGoToStep}
    >
      {({ wizardData }) => (
        <ExportProvider>
          <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
            <Header
              onLoadManifest={() => navigateWithConfirm("/projects/new/import")}
              isEditing={isEditing}
              onNewProject={() => navigateWithConfirm("/projects/new")}
              onOpenWelcomeManifest={() =>
                navigateWithConfirm("/projects/new/ai")
              }
              onNavigateToProjects={onNavigateToProjects}
            />

            <main className="flex-1 flex flex-col overflow-hidden">
              <ResizableLayout
                leftTitle="HexaGen Project Wizard"
                rightTitle="AI Governance"
                onRightPanelClose={onCloseRightPanel}
                onLeftPanelClose={onCloseMiddlePanel}
                left={
                  <WizardStepRouter
                    currentStepIndex={currentStepIndex}
                    totalSteps={totalSteps}
                    onViewModeChange={onViewModeChange}
                    activeContextId={ui.activeContextId ?? ""}
                    activeMappingId={ui.activeMappingId ?? ""}
                    onContextSelect={(id) => ui.setContextId(id)}
                    onMappingSelect={(id) => ui.setMappingId(id)}
                  />
                }
                middle={
                  <ArchitecturePreviewPane
                    wizardData={wizardData}
                    viewMode={viewMode}
                    selectedFileId={editor.selectedFileId}
                    editedFiles={editor.editedFiles}
                    onViewModeChange={onViewModeChange}
                    onFileSelect={editor.selectFile}
                    onFileContentChange={editor.updateFile}
                    onFileSave={editor.markFileSaved}
                  />
                }
                right={
                  <GovernancePanelWrapper
                    wizardData={wizardData}
                    currentStepIndex={currentStepIndex}
                  />
                }
              />
            </main>

            <NewProjectConfirmDialog
              isOpen={ui.dialog.kind === "new-project"}
              onClose={ui.closeDialog}
              pendingRoute={pendingRoute}
              router={router}
            />
          </div>
          {children}
        </ExportProvider>
      )}
    </WizardLifecycleProvider>
  );
}
