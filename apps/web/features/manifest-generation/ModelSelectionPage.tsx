"use client";

import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@hexagen/ui";
import { ModelSettingsView } from "@hexagen/model-settings";
import { ArrowLeft } from "lucide-react";
import { ProjectsShell } from "@/landing/ProjectsShell";
import { useModelSelectionIntent } from "./store/useModelSelectionIntent";
import { ModelProgressCard } from "@/governance-assistant/ModelProgressCard";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import type { DomainModelId } from "../../lib/llm-interfaces";
import type { LLMEngineStatus, ModelMetadata } from "@hexagen/local-llm";

interface ModelSelectionPageProps {
  llmContext: LocalLLMContext;
}

export function ModelSelectionPage({ llmContext }: ModelSelectionPageProps) {
  const router = useRouter();
  const { clear } = useModelSelectionIntent();
  const [mounted, setMounted] = useState(false);
  const llmRef = useRef(llmContext);
  llmRef.current = llmContext;

  useEffect(() => {
    setMounted(true);
  }, []);

  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl");

  const isModelReady = llmContext.engineState.status === "ready";

  const handleBack = useCallback(() => {
    clear();
    router.push(returnUrl || "/projects/new/ai");
  }, [clear, router, returnUrl]);

  const handleGenerate = useCallback(() => {
    clear();
    if (returnUrl) {
      router.push(returnUrl);
    } else {
      router.push("/projects/new/ai?generate=1");
    }
  }, [clear, router, returnUrl]);

  const handleSelectModel = useCallback(async (modelId: DomainModelId) => {
    const ctx = llmRef.current;
    if (ctx.engineState.loadedModelId) {
      return ctx.switchModel(modelId);
    }
    return ctx.initializeModel(modelId);
  }, []);

  const handleDeleteModel = useCallback(async (modelId: DomainModelId) => {
    return llmRef.current.deleteCachedModel(modelId);
  }, []);

  const handleHasModelInCache = useCallback(
    (modelId: DomainModelId) => llmRef.current.hasModelInCache(modelId),
    [],
  );

  const isLoading =
    llmContext.engineState.status === "downloading" ||
    llmContext.engineState.status === "loading_vram";

  const engineStatus = llmContext.engineState.status;
  const isModelLoading =
    engineStatus === "downloading" || engineStatus === "loading_vram";
  const isModelError = engineStatus === "error";

  const footer = (
    <>
      <Button variant="secondary" onClick={handleBack}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>
      {isModelReady && !isModelLoading && !isModelError ? (
        <Button onClick={handleGenerate}>
          {returnUrl ? "Continue" : "Generate Manifest"}
        </Button>
      ) : (
        <span />
      )}
    </>
  );

  return (
    <>
      <ProjectsShell
        headerContent={
          <span className="font-semibold text-sm truncate">Choose Model</span>
        }
        footer={footer}
      >
        <div className="h-full flex flex-col">
          <div className="text-center my-3 sm:my-6">
            <h2 className="text-2xl font-bold text-foreground">
              Choose a Model
            </h2>
            <p className="text-base text-muted-foreground">
              Configure your AI model for manifest generation
            </p>
          </div>

          <div
            className={`flex-1 min-h-0 overflow-hidden ${isModelLoading || isModelError ? "pointer-events-none opacity-50" : ""}`}
          >
            {useMemo(
              () => (
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
              ),
              [
                llmContext.engineState.loadedModelId,
                llmContext.loadedModel,
                handleSelectModel,
                handleDeleteModel,
                handleHasModelInCache,
                isLoading,
              ],
            )}
          </div>
        </div>
      </ProjectsShell>

      {mounted &&
        (isModelLoading || isModelError) &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget && isModelLoading) return;
            }}
            aria-modal="true"
            role="dialog"
          >
            <div
              className="w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <ModelProgressCard
                status={engineStatus as LLMEngineStatus}
                progress={llmContext.engineState.progress}
                errorMessage={llmContext.engineState.errorMessage}
                onCancel={() => {
                  clear();
                  router.push(returnUrl || "/projects/new/ai");
                }}
                onRetry={() => {
                  const modelId = llmContext.engineState.loadedModelId;
                  if (modelId) llmContext.initializeModel(modelId);
                }}
                model={llmContext.loadedModel as ModelMetadata | null}
                modelId={
                  llmContext.engineState.loadedModelId as
                    | DomainModelId
                    | undefined
                }
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
