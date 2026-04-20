import {
  WorkspaceGovernanceStep,
  BoundedContextStep,
  PeerContextMappingStep,
  PortConfigurationStep,
  SummaryStep,
} from "@/components/project-wizard/steps";
import { wizardSteps } from "./config";

interface WizardStepRouterProps {
  currentStepIndex: number;
  totalSteps: number;
  canProceed: boolean;
  isGenerating: boolean;
  activeContextId: string;
  activeMappingId: string;
  onContextSelect: (id: string) => void;
  onMappingSelect: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
  onShowSavedProjects: () => void;
  onGenerate: () => void;
  onViewModeChange: (mode: "visual" | "code") => void;
}

export function WizardStepRouter({
  currentStepIndex,
  totalSteps,
  canProceed,
  isGenerating,
  activeContextId,
  activeMappingId,
  onContextSelect,
  onMappingSelect,
  onNext,
  onBack,
  onShowSavedProjects,
  onGenerate,
  onViewModeChange,
}: WizardStepRouterProps) {
  const currentStepConfig = wizardSteps[currentStepIndex];
  const title = currentStepConfig?.title ?? "";
  const description = currentStepConfig?.description ?? "";

  switch (currentStepIndex) {
    case 0:
      return (
        <WorkspaceGovernanceStep
          onNext={onNext}
          onShowSavedProjects={onShowSavedProjects}
          canProceed={canProceed}
          currentStep={1}
          totalSteps={totalSteps}
          title={title}
          description={description}
        />
      );
    case 1:
      return (
        <BoundedContextStep
          onNext={onNext}
          onBack={onBack}
          canProceed={canProceed}
          activeContextId={activeContextId}
          onContextSelect={onContextSelect}
          currentStep={2}
          totalSteps={totalSteps}
          title={title}
          description={description}
        />
      );
    case 2:
      return (
        <PeerContextMappingStep
          onNext={onNext}
          onBack={onBack}
          canProceed={canProceed}
          activeMappingId={activeMappingId}
          onMappingSelect={onMappingSelect}
          currentStep={3}
          totalSteps={totalSteps}
          title={title}
          description={description}
        />
      );
    case 3:
      return (
        <PortConfigurationStep
          onNext={onNext}
          onBack={onBack}
          canProceed={canProceed}
          currentStep={4}
          totalSteps={totalSteps}
          title={title}
          description={description}
        />
      );
    case 4:
      return (
        <SummaryStep
          onBack={onBack}
          onGenerate={onGenerate}
          canProceed={canProceed}
          isGenerating={isGenerating}
          onViewModeChange={onViewModeChange}
          currentStep={5}
          totalSteps={totalSteps}
          title={title}
          description={description}
        />
      );
    default:
      return null;
  }
}
