import {
  WorkspaceGovernanceStep,
  BoundedContextStep,
  BoundedContextSidebar,
  PeerContextMappingStep,
  PeerMappingSidebar,
  PortConfigurationStep,
  SummaryStep,
  GitHubExportStep,
} from "@/components/project-wizard/steps";
import { SidebarStepLayout } from "./SidebarStepLayout";

// We define exactly what the router needs from the parent
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
  onGenerate,
  onViewModeChange,
}: WizardStepRouterProps) {
  switch (currentStepIndex) {
    case 0:
      return (
        <WorkspaceGovernanceStep
          onNext={onNext}
          onBack={onBack}
          canProceed={canProceed} // Handled specifically for step 0 in parent
          currentStep={1}
          totalSteps={totalSteps}
        />
      );
    case 1:
      return (
        <SidebarStepLayout
          sidebar={
            <BoundedContextSidebar
              activeContextId={activeContextId}
              onContextSelect={onContextSelect}
            />
          }
        >
          <BoundedContextStep
            onNext={onNext}
            onBack={onBack}
            canProceed={canProceed}
            activeContextId={activeContextId}
          />
        </SidebarStepLayout>
      );
    case 2:
      return (
        <SidebarStepLayout
          sidebar={
            <PeerMappingSidebar
              activeMappingId={activeMappingId}
              onMappingSelect={onMappingSelect}
            />
          }
        >
          <PeerContextMappingStep
            onNext={onNext}
            onBack={onBack}
            canProceed={canProceed}
            activeMappingId={activeMappingId}
            currentStep={3}
            totalSteps={totalSteps}
          />
        </SidebarStepLayout>
      );
    case 3:
      return (
        <PortConfigurationStep
          onNext={onNext}
          onBack={onBack}
          canProceed={canProceed}
          currentStep={4}
          totalSteps={totalSteps}
        />
      );
    case 4:
      return (
        <GitHubExportStep
          onNext={onNext}
          onBack={onBack}
          canProceed={canProceed}
          currentStep={5}
          totalSteps={totalSteps}
        />
      );
    case 5:
      return (
        <SummaryStep
          onBack={onBack}
          onGenerate={onGenerate}
          canProceed={canProceed}
          isGenerating={isGenerating}
          onViewModeChange={onViewModeChange}
          currentStep={6}
          totalSteps={totalSteps}
        />
      );
    default:
      return null;
  }
}
