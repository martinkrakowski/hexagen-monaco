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
  Hexagon,
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
  { id: "hexagonal", icon: Hexagon, label: "Hexagonal" },
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
        router.push("/projects/new/ai/approve");
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
        <div className="flex items-center gap-1">
          {TAB_CONFIG.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => previewActions.onTabChange(id)}
              className={`flex items-center px-2.5 py-1 rounded-md text-xs transition-colors ${
                previewActions.activeTab === id
                  ? "bg-accent/10 text-accent border border-accent/20"
                  : "text-muted-foreground hover:bg-card hover:text-foreground border border-transparent"
              }`}
            >
              <Icon className="w-3 h-3 mr-1" /> {label}
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
          <Button variant="outline" onClick={previewActions.onRegenerate}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Regenerate
          </Button>
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
        <Button variant="outline" onClick={() => router.push("/projects/new")}>
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
