"use client";

import { useCallback, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Download, Github } from "lucide-react";
import type {
  ProjectConfig,
  BoundedContext,
  PeerContextMapping,
} from "@hexagen/project-configuration";
import { getWorkspaceTemplate } from "@hexagen/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { useExternalIntegration } from "@/contexts/ExternalIntegrationContext";
import {
  ExportDialog,
  type ExportDialogSubmitPayload,
} from "@/components/export/ExportDialog";
import { StepHeader } from "./StepHeader";
import { WizardFooter } from "../WizardFooter";

interface SummaryStepProps {
  onBack: () => void;
  onGenerate: () => void;
  canProceed: boolean;
  isGenerating: boolean;
  onViewModeChange: (mode: "visual" | "code") => void;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
}

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const { activeWorkspace } = useActiveWorkspace();
  const { isAuthenticated, signIn } = useExternalIntegration();

  const governance = watch("governance");
  const boundedContexts = watch("boundedContexts") || [];
  const peerMappings = watch("peerMappings") || [];

  const handleConfirm = () => {
    setDialogOpen(false);
    onGenerate();
    onViewModeChange("code");
  };

  const canExport = !!activeWorkspace;

  const handleDownloadZip = useCallback(async () => {
    if (!activeWorkspace) return;
    setExporting(true);
    setExportError(null);
    setExportStatus(null);
    try {
      const response = await fetch("/api/export/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeWorkspace.projectId,
          wizardData: activeWorkspace.wizardData,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `ZIP export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${activeWorkspace.name || activeWorkspace.projectId}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportStatus("ZIP downloaded");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "ZIP export failed");
    } finally {
      setExporting(false);
    }
  }, [activeWorkspace]);

  const handlePushClick = useCallback(async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }
    setExportError(null);
    setExportStatus(null);
    setExportDialogOpen(true);
  }, [isAuthenticated, signIn]);

  const handleExportSubmit = useCallback(
    async ({ repoName, isPrivate }: ExportDialogSubmitPayload) => {
      if (!activeWorkspace) return;
      setExporting(true);
      setExportError(null);
      try {
        const response = await fetch("/api/export/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeWorkspace.projectId,
            repoName,
            isPrivate,
            wizardData: activeWorkspace.wizardData,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          destinationUrl?: string;
        };
        if (!response.ok || data.error) {
          throw new Error(data.error ?? `Push failed (${response.status})`);
        }
        if (data.destinationUrl) {
          setExportStatus(`Pushed to ${data.destinationUrl}`);
          window.open(data.destinationUrl, "_blank", "noopener,noreferrer");
        }
        setExportDialogOpen(false);
      } catch (e) {
        setExportError(e instanceof Error ? e.message : "GitHub push failed");
      } finally {
        setExporting(false);
      }
    },
    [activeWorkspace],
  );

  const totalPorts = boundedContexts.reduce(
    (sum: number, ctx: BoundedContext) => {
      const inCount = ctx.portConfiguration?.inboundPorts?.length || 0;
      const outCount = ctx.portConfiguration?.outboundPorts?.length || 0;
      return sum + inCount + outCount;
    },
    0,
  );

  return (
    <div className="flex flex-col h-full bg-card">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={title || "Project Summary"}
        description={description || "Review your project configuration."}
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-4">
        <div className="space-y-6">
          <div className="space-y-4">
            {/* Workspace Governance Summary */}
            <div className="border border-border rounded-lg p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Workspace Governance
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Name:</span>{" "}
                  <span className="font-medium">
                    {governance?.workspaceName || "Not set"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Package Manager:
                  </span>{" "}
                  <span className="font-medium">
                    {governance?.packageManager || "yarn"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Topology:</span>{" "}
                  <span className="font-medium">
                    {governance?.topologyStrictness || "flexible"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Namespace:</span>{" "}
                  <span className="font-medium">
                    {governance?.namespacePrefix || "@hexagen"}
                  </span>
                </div>
              </div>
            </div>

            {/* Bounded Contexts Summary */}
            <div className="border border-border rounded-lg p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Bounded Contexts ({boundedContexts.length})
              </h3>
              <div className="space-y-2">
                {boundedContexts.map((ctx: BoundedContext, i: number) => (
                  <div key={ctx.id} className="flex items-center gap-2 text-sm">
                    <span className="text-xs font-mono text-muted-foreground">
                      {i + 1}.
                    </span>
                    <span className="font-medium">{ctx.name || "Unnamed"}</span>
                    <span className="text-muted-foreground text-xs">
                      ({ctx.infrastructureTarget || "nestjs"})
                    </span>
                    {ctx.portConfiguration?.inboundPorts && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        {ctx.portConfiguration.inboundPorts.length} in
                      </span>
                    )}
                    {ctx.portConfiguration?.outboundPorts && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        {ctx.portConfiguration.outboundPorts.length} out
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Peer Mappings Summary */}
            {peerMappings.length > 0 && (
              <div className="border border-border rounded-lg p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  Peer Mappings ({peerMappings.length})
                </h3>
                <div className="space-y-2">
                  {peerMappings.map(
                    (mapping: PeerContextMapping, i: number) => {
                      const consumer = boundedContexts.find(
                        (c) => c.id === mapping.consumerContext,
                      );
                      const provider = boundedContexts.find(
                        (c) => c.id === mapping.providerContext,
                      );
                      return (
                        <div key={i} className="text-sm">
                          <span className="font-medium">
                            {consumer?.name || "Unknown"}
                          </span>{" "}
                          <span className="text-muted-foreground">→</span>{" "}
                          <span className="font-medium">
                            {provider?.name || "Unknown"}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({mapping.integrationPattern},{" "}
                            {mapping.communicationBoundary})
                          </span>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            )}

            {/* Workspace Template Summary */}
            <div className="border border-border rounded-lg p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Workspace Template
              </h3>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">
                    {getWorkspaceTemplate(watch("governance.workspaceTemplate"))
                      ?.title ?? "Not selected"}
                  </span>
                </div>
              </div>
            </div>

            {/* Export Actions — available once a project has been generated */}
            {canExport ? (
              <div className="border border-border rounded-lg p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  Export
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    disabled={exporting}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border border-input hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                    Download as ZIP
                  </button>
                  <button
                    type="button"
                    onClick={handlePushClick}
                    disabled={exporting}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Github className="w-4 h-4" />
                    {isAuthenticated ? "Push to GitHub" : "Sign in to GitHub"}
                  </button>
                </div>
                {exportStatus ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {exportStatus}
                  </p>
                ) : null}
                {exportError ? (
                  <p className="mt-2 text-xs text-destructive" role="alert">
                    {exportError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <WizardFooter
        onBack={onBack}
        onGenerate={() => setDialogOpen(true)}
        canProceed={canProceed && boundedContexts.length > 0}
        isGenerating={isGenerating}
        currentStep={currentStep}
        totalSteps={totalSteps}
        showNext={false}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Project</DialogTitle>
            <DialogDescription>
              This will scaffold your project and switch to the code editor
              view.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Bounded Contexts</span>
              <span className="font-medium">{boundedContexts.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Ports</span>
              <span className="font-medium">{totalPorts}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Peer Mappings</span>
              <span className="font-medium">{peerMappings.length}</span>
            </div>
            {governance?.workspaceName && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Workspace</span>
                <span className="font-medium font-mono text-xs">
                  {governance.workspaceName}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors border border-input"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors"
            >
              Generate &amp; Switch to Code View
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onSubmit={handleExportSubmit}
        isSubmitting={exporting}
        initialRepoName={activeWorkspace?.name ?? ""}
        error={exportError}
      />
    </div>
  );
}
