"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { WelcomeScreen } from "./WelcomeScreen";
import { usePendingManifest } from "./store/usePendingManifest";
import { parseManifestToWizardData } from "@hexagen/wizard-orchestration";
import type { LocalLLMContext } from "../../lib/llm-interfaces";

interface AIGenerationPageProps {
  llmContext: LocalLLMContext;
}

export function AIGenerationPage({ llmContext }: AIGenerationPageProps) {
  const router = useRouter();
  const { set: setPendingManifest } = usePendingManifest();

  const handleUseManifest = useCallback(
    (yaml: string) => {
      const wizardData = parseManifestToWizardData(yaml);
      const projectName =
        wizardData.governance?.workspaceName ||
        `AI Project ${new Date().toLocaleTimeString()}`;
      setPendingManifest(yaml, wizardData, projectName);
      router.push("/projects/new/ai/accept");
    },
    [setPendingManifest, router],
  );

  const handleImportManifest = useCallback(() => {
    router.push("/projects/new/import");
  }, [router]);

  const handleStartWizard = useCallback(() => {
    router.push("/wizard/1?new=true");
  }, [router]);

  const handleLoadProject = useCallback(
    (id: string) => {
      router.push(`/wizard/1?project=${id}`);
    },
    [router],
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

        <WelcomeScreen
          onUseManifest={handleUseManifest}
          llmContext={llmContext}
          onImportManifest={handleImportManifest}
          onStartWizard={handleStartWizard}
          onLoadProject={handleLoadProject}
        />
      </div>
    </div>
  );
}
