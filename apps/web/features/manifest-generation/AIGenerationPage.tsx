"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { GenerateWithAi } from "./GenerateWithAi";
import { usePendingManifest } from "./store/usePendingManifest";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";
import type { LocalLLMContext } from "../../lib/llm-interfaces";

interface AIGenerationPageProps {
  llmContext: LocalLLMContext;
}

export function AIGenerationPage({ llmContext }: AIGenerationPageProps) {
  const router = useRouter();
  const { set: setPendingManifest } = usePendingManifest();

  const [parseError, setParseError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push("/projects/new")}
            className="p-1.5 hover:bg-card rounded-md transition-colors"
            title="Back to project creation"
          >
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <h1 className="text-2xl font-bold text-foreground">
            Generate with AI
          </h1>
        </div>

        {parseError && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
            {parseError}
          </div>
        )}
        <GenerateWithAi
          onUseManifest={handleUseManifest}
          llmContext={llmContext}
        />
      </div>
    </div>
  );
}
