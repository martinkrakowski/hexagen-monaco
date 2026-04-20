import { WizardStepRouter } from "@/components/project-wizard/WizardStepRouter";
import { SavedProjectsList } from "@/components/project-wizard/SavedProjectsList";

import type { SavedProject } from "@/hooks/useSavedProjects";
import type { WizardDraft } from "@hexagen/shared";

interface WizardOrSavedProjectsPaneProps {
  showSavedProjects: boolean;
  currentStepIndex: number;
  totalSteps: number;
  canProceed: boolean;
  isGenerating: boolean;
  activeContextId: string;
  activeMappingId: string;
  projects: SavedProject[];
  draft: WizardDraft | null;
  loadedProjectId: string | null;
  onContextSelect: (id: string) => void;
  onMappingSelect: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
  onShowSavedProjects: () => void;
  onGenerate: () => void;
  onViewModeChange: (mode: "visual" | "code") => void;
  onLoadProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  onBackToWizard: () => void;
}

export function WizardOrSavedProjectsPane({
  showSavedProjects,
  currentStepIndex,
  totalSteps,
  canProceed,
  isGenerating,
  activeContextId,
  activeMappingId,
  projects,
  draft,
  loadedProjectId,
  onContextSelect,
  onMappingSelect,
  onNext,
  onBack,
  onShowSavedProjects,
  onGenerate,
  onViewModeChange,
  onLoadProject,
  onDeleteProject,
  onRenameProject,
  onResumeDraft,
  onDiscardDraft,
  onBackToWizard,
}: WizardOrSavedProjectsPaneProps) {
  if (showSavedProjects) {
    return (
      <SavedProjectsList
        projects={projects}
        onLoad={onLoadProject}
        onDelete={onDeleteProject}
        onRename={onRenameProject}
        onBackToWizard={onBackToWizard}
        draft={draft}
        onResumeDraft={onResumeDraft}
        onDiscardDraft={onDiscardDraft}
        loadedProjectId={loadedProjectId}
      />
    );
  }

  return (
    <WizardStepRouter
      currentStepIndex={currentStepIndex}
      totalSteps={totalSteps}
      canProceed={canProceed}
      isGenerating={isGenerating}
      activeContextId={activeContextId}
      activeMappingId={activeMappingId}
      onContextSelect={onContextSelect}
      onMappingSelect={onMappingSelect}
      onNext={onNext}
      onBack={onBack}
      onShowSavedProjects={onShowSavedProjects}
      onGenerate={onGenerate}
      onViewModeChange={onViewModeChange}
    />
  );
}
