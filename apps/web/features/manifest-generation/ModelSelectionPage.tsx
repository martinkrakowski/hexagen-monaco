"use client";

import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@hexagen/ui";
import { ModelSettingsView } from "@hexagen/model-settings";
import { ArrowLeft } from "lucide-react";
import { ProjectsShellWithFreeTier } from "@/landing/ProjectsShellWithFreeTier";
import { useModelSelectionIntent } from "./store/useModelSelectionIntent";
import { usePreferredLLM } from "@/lib/free-tier/store/usePreferredLLM";
import { ModelProgressCard } from "@/governance-assistant/ModelProgressCard";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import type { DomainModelId } from "../../lib/llm-interfaces";
import type { LLMEngineStatus, ModelMetadata } from "@hexagen/local-llm";
import { hasServerLLMAccessKey } from "../../app/lib/wire";
import { getCapabilities } from "@/lib/manifest-generation";
import { useSuppressLLMLoadingModal } from "@/contexts/LLMLoadingModalContext";

interface ModelSelectionPageProps {
  llmContext: LocalLLMContext;
}

export function ModelSelectionPage({ llmContext }: ModelSelectionPageProps) {
  const router = useRouter();
  const { clear } = useModelSelectionIntent();
  const { setPreferredLocalModel } = usePreferredLLM();
  useSuppressLLMLoadingModal();
  const [mounted, setMounted] = useState(false);
  const llmRef = useRef(llmContext);
  llmRef.current = llmContext;

  const [serverModelName, setServerModelName] = useState<string>("gpt-4o-mini");
  const [generationModelName, setGenerationModelName] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    setMounted(true);
    getCapabilities()
      .then((res) => {
        if (res.activeModelName) {
          setServerModelName(res.activeModelName);
        }
        setGenerationModelName(res.generationModelName);
      })
      .catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("Failed to fetch capabilities / serverModelName:", err);
        }
      });
  }, []);

  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl");
  // The genesis flow carries `?name=` through the /models detour: it keys the
  // genesis settings-store snapshot and seeds the saved-project name, so both
  // genesis return legs must echo it back or the workbench form reseeds from
  // blank on return (the returnUrl arm is owned by its caller and untouched).
  const carriedName = searchParams.get("name");
  const genesisPath = carriedName
    ? `/projects/new/ai?name=${encodeURIComponent(carriedName)}`
    : "/projects/new/ai";
  const genesisAutoStartPath = carriedName
    ? `/projects/new/ai?generate=1&name=${encodeURIComponent(carriedName)}`
    : "/projects/new/ai?generate=1";

  const hasServerApiKey = hasServerLLMAccessKey();
  const isModelReady =
    hasServerApiKey || llmContext.engineState.status === "ready";

  const handleBack = useCallback(() => {
    clear();
    router.push(returnUrl || genesisPath);
  }, [clear, router, returnUrl, genesisPath]);

  const handleGenerate = useCallback(() => {
    // Save the currently loaded model as the preferred one
    if (llmContext.engineState.loadedModelId) {
      setPreferredLocalModel(llmContext.engineState.loadedModelId);
    }
    clear();
    if (returnUrl) {
      router.push(returnUrl);
    } else {
      router.push(genesisAutoStartPath);
    }
  }, [
    clear,
    router,
    returnUrl,
    genesisAutoStartPath,
    llmContext.engineState.loadedModelId,
    setPreferredLocalModel,
  ]);

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
      <ProjectsShellWithFreeTier
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
                  hasServerApiKey={hasServerApiKey}
                  serverModelName={serverModelName}
                  generationModelName={generationModelName}
                />
              ),
              [
                llmContext.engineState.loadedModelId,
                llmContext.loadedModel,
                handleSelectModel,
                handleDeleteModel,
                handleHasModelInCache,
                isLoading,
                hasServerApiKey,
                serverModelName,
                generationModelName,
              ],
            )}
          </div>
        </div>
      </ProjectsShellWithFreeTier>

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
                  // Third genesis return leg: cancelling a download must echo
                  // `?name=` back like Back/Generate, or the workbench form
                  // reseeds from blank and strands the Section A edits.
                  router.push(returnUrl || genesisPath);
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
