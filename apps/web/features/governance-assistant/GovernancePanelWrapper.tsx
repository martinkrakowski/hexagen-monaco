"use client";

import { useState } from "react";
import type { WizardData } from "@hexagen/project-configuration";
import { Tabs } from "@hexagen/ui";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { useGovernanceData } from "./hooks/useGovernanceData";
import { GovernanceAssistantPanel } from "./GovernanceAssistantPanel";
import { ArchitectureModificationPanel } from "./architecture-modification";

type PanelMode = "qa" | "modify";

interface GovernancePanelWrapperProps {
  wizardData: WizardData;
  currentStepIndex: number;
}

export function GovernancePanelWrapper({
  wizardData,
  currentStepIndex,
}: GovernancePanelWrapperProps) {
  const { data, isLoading: isGovernanceLoading, refresh } = useGovernanceData();
  const [mode, setMode] = useState<PanelMode>("qa");

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-full">
        <Tabs.Root value={mode} onValueChange={(v) => setMode(v as PanelMode)}>
          <Tabs.List>
            <Tabs.Trigger value="qa">Q&A</Tabs.Trigger>
            <Tabs.Trigger value="modify">Modify</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="qa" className="flex-1 overflow-hidden">
            <GovernanceAssistantPanel
              wizardData={wizardData}
              currentStepIndex={currentStepIndex}
              violations={data.violations}
              suggestions={data.suggestions}
              onRefresh={refresh}
              isLoading={isGovernanceLoading}
            />
          </Tabs.Content>

          <Tabs.Content value="modify" className="flex-1 overflow-hidden">
            <ArchitectureModificationPanel />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </ErrorBoundary>
  );
}
