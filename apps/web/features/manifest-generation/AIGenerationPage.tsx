"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { GenerateWithAi } from "./GenerateWithAi";
import { usePendingManifest } from "./store/usePendingManifest";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";
import { ProjectsShell } from "@/landing/ProjectsShell";
import { Button } from "@hexagen/ui";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Network,
  Component,
  ShieldCheck,
} from "lucide-react";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import type { PreviewFooterActions, ViewTab } from "./GenerateWithAi/types";

interface AIGenerationPageProps {
  llmContext: LocalLLMContext;
}

const TAB_CONFIG: { id: ViewTab; icon: typeof Network; label: string }[] = [
  { id: "context-map", icon: Network, label: "Context Map" },
  { id: "mermaid", icon: Component, label: "Mermaid" },
  { id: "validation", icon: ShieldCheck, label: "Validation" },
];

export function AIGenerationPage({ llmContext }: AIGenerationPageProps) {
  const router = useRouter();
  const { set: setPendingManifest } = usePendingManifest();

  const [parseError, setParseError] = useState<string | null>(null);
  const [previewActions, setPreviewActions] =
    useState<PreviewFooterActions | null>(null);

  const handleUseManifest = useCallback(
    (yaml: string) => {
      try {
        setParseError(null);
        const wizardData = parseManifestToWizardData(yaml);
        const projectName =
          wizardData.governance?.workspaceName ||
          `AI Project ${new Date().toLocaleTimeString()}`;
        setPendingManifest(yaml, wizardData, projectName);
        router.push("/projects/new/ai/accept");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to parse generated manifest";
        setParseError(message);
      }
    },
    [setPendingManifest, router],
  );

  const renderHeaderContent = () => {
    if (!previewActions) {
      return (
        <span className="font-semibold text-sm truncate">Generate with AI</span>
      );
    }

    const scoreColor =
      previewActions.overallScore >= 80
        ? "bg-success/10 text-success border-success/20"
        : previewActions.overallScore >= 50
          ? "bg-warning/10 text-warning border-warning/20"
          : "bg-destructive/10 text-destructive border-destructive/20";

    return (
      <>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm truncate">
            Generated Manifest
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono border ${scoreColor}`}
          >
            {previewActions.overallScore}% Score
          </span>
          <span className="text-xs text-muted-foreground font-mono hidden md:inline">
            {previewActions.systemLabel} · {previewActions.architectureLabel} ·{" "}
            {previewActions.contextCount} contexts
          </span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto shrink-0">
          {TAB_CONFIG.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => previewActions.onTabChange(id)}
              aria-label={label}
              className={`flex items-center px-2 py-1 rounded-md text-xs transition-colors shrink-0 ${
                previewActions.activeTab === id
                  ? "bg-accent text-accent-foreground border border-accent"
                  : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"
              }`}
            >
              <Icon className="w-3 h-3 sm:mr-1" />{" "}
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </>
    );
  };

  const renderFooter = () => {
    if (previewActions) {
      return (
        <>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={previewActions.onBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button variant="secondary" onClick={previewActions.onRegenerate}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate
            </Button>
          </div>
          <Button
            onClick={() =>
              previewActions.onUseManifest(previewActions.manifestYaml)
            }
            disabled={previewActions.hasFailures}
          >
            Use This Manifest
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </>
      );
    }

    return (
      <>
        <Button
          variant="secondary"
          onClick={() => router.push("/projects/new")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <span />
      </>
    );
  };

  return (
    <ProjectsShell
      headerContent={renderHeaderContent()}
      footer={renderFooter()}
    >
      <div className="h-full flex flex-col">
        {parseError && (
          <div className="p-4 mb-4 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive shrink-0">
            {parseError}
          </div>
        )}
        <div className="flex-1 min-h-0">
          <GenerateWithAi
            onUseManifest={handleUseManifest}
            llmContext={llmContext}
            onPreviewStateChange={setPreviewActions}
          />
        </div>
      </div>
    </ProjectsShell>
  );
}
