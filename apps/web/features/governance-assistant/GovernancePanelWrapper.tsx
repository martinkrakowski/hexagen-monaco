"use client";

import React, { useState } from "react";
import { Tabs } from "@hexagen/ui";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { useGovernanceData } from "./hooks/useGovernanceData";
import { GovernanceAssistantPanel } from "./GovernanceAssistantPanel";
import { ArchitectureModificationPanel } from "./architecture-modification";
// eslint-disable-next-line hexagen-ui/no-feature-slice-imports
import { useWizardData } from "../workspace-shell/contexts/WizardLifecycleContext";

type PanelMode = "qa" | "modify";

interface GovernancePanelWrapperProps {
  currentStepIndex: number;
  /** If false, skip governance API calls (for new projects without manifest) */
  enabled?: boolean;
}

export const GovernancePanelWrapper = React.memo(
  function GovernancePanelWrapper({
    currentStepIndex,
    enabled = true,
  }: GovernancePanelWrapperProps) {
    const wizardData = useWizardData();
    const {
      data,
      isLoading: isGovernanceLoading,
      refresh,
    } = useGovernanceData({ enabled });
    const [mode, setMode] = useState<PanelMode>("qa");

    return (
      <ErrorBoundary>
        <div className="flex flex-col h-full">
          <Tabs.Root
            value={mode}
            onValueChange={(v) => setMode(v as PanelMode)}
          >
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
  },
);
