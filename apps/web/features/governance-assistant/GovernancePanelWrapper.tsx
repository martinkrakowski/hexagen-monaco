"use client";

import type { WizardData } from "@hexagen/shared";
import { useGovernanceData } from "@/hooks/useGovernanceData";
import { GovernanceAssistantPanel } from "./GovernanceAssistantPanel";

interface GovernancePanelWrapperProps {
  wizardData: WizardData;
  currentStepIndex: number;
}

export function GovernancePanelWrapper({
  wizardData,
  currentStepIndex,
}: GovernancePanelWrapperProps) {
  const { data, isLoading: isGovernanceLoading, refresh } = useGovernanceData();

  return (
    <GovernanceAssistantPanel
      wizardData={wizardData}
      currentStepIndex={currentStepIndex}
      violations={data.violations}
      suggestions={data.suggestions}
      onRefresh={refresh}
      isLoading={isGovernanceLoading}
    />
  );
}
