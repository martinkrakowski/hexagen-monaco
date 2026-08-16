"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import type {
  ProjectConfig,
  BoundedContext,
} from "@hexagen/project-configuration";

import { useZipExport } from "@/contexts/ZipExportContext";
import { useGithubPublish } from "@/contexts/GithubPublishContext";
import { useProjectExportRecord } from "@/contexts/ProjectExportRecordContext";
import type { ViewMode } from "@/types/view-mode";
import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";
import {
  GovernanceSummary,
  BoundedContextsSummary,
  PeerMappingsSummary,
  WorkspaceTemplateSummary,
  AddOnsSummary,
  ExportActions,
  GenerateConfirmDialog,
} from "./summary-step";

interface SummaryStepProps {
  onBack: () => void;
  onGenerate: () => void;
  canProceed: boolean;
  isGenerating: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

/**
 * Final wizard step. Renders a read-only review of every prior step's
 * configuration (governance, contexts, mappings, template), export
 * actions once a project has been generated, and a confirm-to-
 * generate dialog. Sub-components live under ./summary-step/.
 */
export function SummaryStep({
  onBack,
  onGenerate,
  canProceed,
  isGenerating,
  onViewModeChange,
  currentStep = 6,
  totalSteps = 6,
  title,
  description,
}: SummaryStepProps) {
  const { watch } = useFormContext<ProjectConfig>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { state: zipState, canExport, exportZip } = useZipExport();
  const {
    isAuthenticated,
    isPublishing,
    requestGithubExport,
    openPublishSettings,
  } = useGithubPublish();
  // The publish record is the single owner of the connected link (GOD-004), and
  // it adopts the server's link the moment a publish succeeds — so the
  // indicator no longer needs a second IDB read keyed on the export state.
  const { connectedRepo } = useProjectExportRecord();

  const isExporting = zipState.kind === "exporting" || isPublishing;

  const governance = watch("governance");
  const boundedContexts = watch("boundedContexts") || [];
  const peerMappings = watch("peerMappings") || [];
  const workspaceTemplate = watch("governance.workspaceTemplate");

  // Derived: total ports across all contexts. Shown in the confirm dialog.
  const totalPorts = boundedContexts.reduce(
    (sum: number, ctx: BoundedContext) => {
      const inCount = ctx.portConfiguration?.inboundPorts?.length || 0;
      const outCount = ctx.portConfiguration?.outboundPorts?.length || 0;
      return sum + inCount + outCount;
    },
    0,
  );

  const handleConfirm = () => {
    setConfirmOpen(false);
    onGenerate();
    onViewModeChange("code");
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Project Summary"}
        description={description || "Review your project configuration."}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-4">
        <div className="space-y-4">
          <GovernanceSummary governance={governance} />
          <BoundedContextsSummary boundedContexts={boundedContexts} />
          {peerMappings.length > 0 && (
            <PeerMappingsSummary
              peerMappings={peerMappings}
              boundedContexts={boundedContexts}
            />
          )}
          <WorkspaceTemplateSummary workspaceTemplate={workspaceTemplate} />
          <AddOnsSummary />
          {canExport && (
            <ExportActions
              isAuthenticated={isAuthenticated}
              isExporting={isExporting}
              onExportZip={() => void exportZip()}
              onRequestGithubExport={() => void requestGithubExport()}
              onOpenPublishSettings={() => void openPublishSettings()}
              connectedRepo={connectedRepo}
            />
          )}
        </div>
      </div>

      <WizardFooter
        onBack={onBack}
        onGenerate={() => setConfirmOpen(true)}
        canProceed={canProceed && boundedContexts.length > 0}
        isGenerating={isGenerating}
        currentStep={currentStep}
        totalSteps={totalSteps}
        showNext={false}
      />

      <GenerateConfirmDialog
        open={confirmOpen}
        boundedContextCount={boundedContexts.length}
        peerMappingCount={peerMappings.length}
        totalPorts={totalPorts}
        workspaceName={governance?.workspaceName}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
