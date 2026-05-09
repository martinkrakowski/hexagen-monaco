"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hexagen/ui";
import { ModelSettingsView } from "@hexagen/model-settings";
import { ArrowLeft } from "lucide-react";
import { ProjectsShell } from "@/landing/ProjectsShell";
import { useModelSelectionIntent } from "./store/useModelSelectionIntent";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import type { DomainModelId } from "../../lib/llm-interfaces";

interface ModelSelectionPageProps {
  llmContext: LocalLLMContext;
}

export function ModelSelectionPage({ llmContext }: ModelSelectionPageProps) {
  const router = useRouter();
  const { autoGenerate, clear } = useModelSelectionIntent();

  const isModelReady = llmContext.engineState.status === "ready";

  const handleBack = useCallback(() => {
    clear();
    router.push("/projects/new/ai");
  }, [clear, router]);

  const handleGenerate = useCallback(() => {
    clear();
    router.push("/projects/new/ai?generate=1");
  }, [clear, router]);

  const handleSelectModel = useCallback(
    async (modelId: DomainModelId) => {
      return llmContext.initializeModel(modelId);
    },
    [llmContext],
  );

  const handleDeleteModel = useCallback(
    async (modelId: DomainModelId) => {
      return llmContext.deleteCachedModel(modelId);
    },
    [llmContext],
  );

  const handleHasModelInCache = useCallback(
    (modelId: DomainModelId) => llmContext.hasModelInCache(modelId),
    [llmContext],
  );

  const isLoading =
    llmContext.engineState.status === "downloading" ||
    llmContext.engineState.status === "loading_vram";

  const footer = (
    <>
      <Button variant="secondary" onClick={handleBack}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>
      {isModelReady && autoGenerate ? (
        <Button onClick={handleGenerate}>Generate Manifest</Button>
      ) : (
        <span />
      )}
    </>
  );

  return (
    <ProjectsShell
      headerContent={
        <span className="font-semibold text-sm truncate">Choose Model</span>
      }
      footer={footer}
    >
      <div className="h-full w-full">
        <div className="flex items-center justify-center min-h-full py-12 px-6">
          <div className="max-w-2xl mx-auto px-6 w-full space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-foreground">
                Choose a Model
              </h2>
              <p className="text-base text-muted-foreground">
                Configure your AI model for manifest generation
              </p>
            </div>

            <ModelSettingsView
              currentModelId={llmContext.engineState.loadedModelId ?? null}
              loadedModel={llmContext.loadedModel}
              messagesLength={0}
              onSwitchModel={handleSelectModel}
              onDeleteModel={handleDeleteModel}
              hasModelInCache={handleHasModelInCache}
              onBack={undefined}
              hideHeader
              isLoading={isLoading}
              onSwitchToCloud={undefined}
              requiresModelWarning={false}
            />
          </div>
        </div>
      </div>
    </ProjectsShell>
  );
}
