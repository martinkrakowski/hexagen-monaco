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

  return (
    <ExportProvider onEditorPushed={editor.clearUnpushed}>
      <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
        <Header
          onLoadManifest={() => handleNavigate("/projects/new/import")}
          isEditing={isEditing}
          onNewProject={() => handleNavigate("/projects/new")}
          onOpenWelcomeManifest={() => handleNavigate("/projects/new/ai")}
          onNavigateToProjects={onNavigateToProjects}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
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
            ui.closeDialog();
          }}
          onProceed={() => {
            const route = pendingRoute.current;
            pendingRoute.current = null;
            ui.closeDialog();
            if (route) router.push(route);
          }}
        />
      </div>
      {children}
    </ExportProvider>
  );
}, projectWorkspaceLayoutPropsEqual);
