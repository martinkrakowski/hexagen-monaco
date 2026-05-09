"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useModelSelectionFlowState } from "../ModelSelectionFlow/useModelSelectionFlowState";
import { useStagedManifestGeneration } from "../useStagedManifestGeneration";
import { getModelPreferences } from "../ModelSelectionFlow/modelPreferencesStorage";
import {
  assessModelCapability,
  parseYamlToViewData,
} from "@hexagen/manifest-generation";
import type { DomainModelId } from "../../../lib/llm-interfaces";
import type { LLMEngineStatus, ModelMetadata } from "@hexagen/local-llm";
import { useWebGPUDetection } from "../ModelSelectionFlow/useWebGPUDetection";
import { ModelProgressCard } from "@/governance-assistant/ModelProgressCard";
import { ModelCapabilityCheck } from "./ModelCapabilityCheck";
import { ActionBar } from "./ActionBar";
import { DescriptionInput } from "./DescriptionInput";
import { ExampleCardsSection } from "./ExampleCardsSection";
import { AdvancedOptionsSection } from "./AdvancedOptionsSection";
import { HeaderSection } from "./HeaderSection";
import { StateView } from "./StateView";
import { ThinkingBlock } from "./ThinkingBlock";
import { GenerateWithAiLayout } from "./GenerateWithAiLayout";
import { useGenerateWithAiForm } from "./hooks/useGenerateWithAiForm";
import type { GenerateWithAiProps, ViewTab } from "./types";
import {
  getCapabilities,
  onCapabilityCacheInvalidated,
} from "@/lib/manifest-generation";
import { hasServerLLMAccessKey } from "../../../app/lib/wire.client";
import type { CapabilitiesResponse } from "../types/capabilities";
import { useModelSelectionIntent } from "../store/useModelSelectionIntent";

export function GenerateWithAi({
  onUseManifest,
  llmContext,
  onGeneratingStateChange,
  onPreviewStateChange,
}: GenerateWithAiProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modelSelectionIntent = useModelSelectionIntent();
  const [formState, formHandlers] = useGenerateWithAiForm();
  const [mounted, setMounted] = useState(false);
  const [overrideModelCheck, setOverrideModelCheck] = useState(false);
  const [previewActiveTab, setPreviewActiveTab] =
    useState<ViewTab>("context-map");

  useEffect(() => {
    setMounted(true);
  }, []);

  /**
   * Tier 1 (Synchronous): Check if server has env-var API key configured.
   * This fires immediately at component init without roundtrip.
   */
  const hasServerApiKey = hasServerLLMAccessKey();

  /**
   * Tier 2 (Asynchronous): Probe server for full capability picture.
   * Always runs to discover BYOK configuration.
   * Resolves BYOK tier for each provider and produces canGenerate aggregate.
   */
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(
    null,
  );

  /**
   * Tier 3 (Synchronous): Check if browser supports WebLLM (local generation).
   * Polls WebGPU capability and hardware constraints.
   */
  const gpuDetection = useWebGPUDetection();
  const hasLocalLLM =
    gpuDetection.isWebGPUSupported && gpuDetection.isHardwareAdequate;

  // Probe capabilities on mount and when cache is invalidated.
  // Always probe for BYOK tier (don't skip based on Tier 1).
  // Tier 1 is a fast-pass (button enabled immediately), not a prerequisite.
  useEffect(() => {
    const probeCapabilities = async () => {
      try {
        const result = await getCapabilities();
        setCapabilities(result);
      } catch {
        // Fail open if probe fails AND Tier 1 passes (env key exists).
        // Fail closed if probe fails AND Tier 1 fails (no env key, no BYOK either).
        setCapabilities({ capabilities: [], canGenerate: hasServerApiKey });
      }
    };

    probeCapabilities();

    // Listen for cache invalidation (e.g., when user adds BYOK key)
    const unsubscribe = onCapabilityCacheInvalidated(() => {
      probeCapabilities();
    });

    return unsubscribe;
  }, [hasServerApiKey]);

  const [flowState, actions] = useModelSelectionFlowState(llmContext);
  const stagedGen = useStagedManifestGeneration();

  useEffect(() => {
    onGeneratingStateChange?.(flowState.state === "generating");
  }, [flowState.state, onGeneratingStateChange]);

  const generateRef = useRef(stagedGen.generateManifest);
  useEffect(() => {
    generateRef.current = stagedGen.generateManifest;
  }, [stagedGen.generateManifest]);

  // Compute provider availability early (before useEffect that uses it)
  const hasCloudKeys = hasServerApiKey || (capabilities?.canGenerate ?? false);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    generateRef.current(formState.description, {
      deployment: formState.deployment,
      signal: undefined,
      preferLocal: !hasCloudKeys && hasLocalLLM,
    });
  }, [
    flowState.state,
    formState.description,
    formState.deployment,
    hasCloudKeys,
    hasLocalLLM,
  ]);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    if (stagedGen.generationError) {
      // Don't transition to error state modal.
      // Keep error inline in welcome form for better UX.
      // Error will be displayed in the form instead.
    }
  }, [stagedGen.generationError, flowState.state, actions]);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    if (stagedGen.generatedManifest) {
      actions.saveGenerationResult(stagedGen.generatedManifest);
    }
  }, [stagedGen.generatedManifest, flowState.state, actions]);

  const loadedModelId = llmContext.engineState.loadedModelId;
  const capability = assessModelCapability(loadedModelId, overrideModelCheck);
  const manifestCapable = capability.isCapable;

  const isNativelyCapable =
    capability.isCapable && !capability.reason.includes("Override");

  useEffect(() => {
    if (isNativelyCapable) {
      setOverrideModelCheck(false);
    }
  }, [isNativelyCapable]);

  // Gate on both model capability AND LLM provider availability.
  // THREE-TIER GATE: button enabled if ANY tier has keys/capability
  // Tier 1 (sync): env key → enabled immediately (fast-pass, don't wait)
  // Tier 2 (async): BYOK configured → enabled after probe completes
  // Tier 3 (sync): WebLLM available → enabled immediately (local fallback)
  // If all tiers missing, button disabled with helpful tooltip
  const hasAnyProvider = hasCloudKeys || hasLocalLLM;
  const canGenerate =
    formHandlers.isValid &&
    flowState.state === "idle" &&
    manifestCapable &&
    hasAnyProvider;

  // Tooltip messaging based on which providers are unavailable
  const disabledTooltip = !hasAnyProvider
    ? "No API keys configured. Add a BYOK key in Settings, set environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, COHERE_API_KEY), or enable local generation with WebLLM (requires WebGPU support)."
    : undefined;

  const navigateToModelSelection = useCallback(
    (autoGenerate = false) => {
      modelSelectionIntent.setAutoGenerate(autoGenerate);
      router.push("/projects/new/ai/models");
    },
    [modelSelectionIntent, router],
  );

  const handleGenerate = () => {
    if (!canGenerate) return;
    const prefs = getModelPreferences();
    if (
      llmContext.engineState.status === "ready" ||
      (prefs.rememberChoice && prefs.lastModelId)
    ) {
      actions.transitionTo("generating");
    } else {
      navigateToModelSelection(true);
    }
  };

  const hasReturnedFromModelSelection = searchParams.get("generate") === "1";

  useEffect(() => {
    if (!hasReturnedFromModelSelection) return;
    if (flowState.state !== "idle") return;
    if (!formHandlers.isValid) return;
    const prefs = getModelPreferences();
    if (
      llmContext.engineState.status === "ready" ||
      (prefs.rememberChoice && prefs.lastModelId)
    ) {
      actions.transitionTo("generating");
      router.replace("/projects/new/ai");
    }
  }, [
    hasReturnedFromModelSelection,
    flowState.state,
    formHandlers.isValid,
    llmContext.engineState.status,
    actions,
    router,
  ]);

  const handleRetryOrRegenerate = useCallback(() => {
    stagedGen.reset();
    actions.regenerateManifest();
  }, [stagedGen, actions]);

  const handleRetryRef = useRef(handleRetryOrRegenerate);
  handleRetryRef.current = handleRetryOrRegenerate;

  const onUseManifestRef = useRef(onUseManifest);
  onUseManifestRef.current = onUseManifest;

  useEffect(() => {
    if (!onPreviewStateChange) return;
    if (flowState.state === "preview" && flowState.manifestContent) {
      const viewData = parseYamlToViewData(flowState.manifestContent);
      const hasFailures = viewData.validationItems.some(
        (v) => v.status === "fail",
      );
      onPreviewStateChange({
        onBack: () => {
          actions.clearError();
          stagedGen.reset();
        },
        onRegenerate: () => handleRetryRef.current(),
        onUseManifest: (yaml) => onUseManifestRef.current?.(yaml),
        manifestYaml: flowState.manifestContent,
        hasFailures,
        activeTab: previewActiveTab,
        onTabChange: setPreviewActiveTab,
        overallScore: viewData.overallScore,
        systemLabel: viewData.system,
        architectureLabel: viewData.architecture,
        contextCount: viewData.contexts.length,
      });
    } else {
      onPreviewStateChange(null);
    }
  }, [
    flowState.state,
    flowState.manifestContent,
    onPreviewStateChange,
    previewActiveTab,
  ]);

  if (flowState.state !== "idle" && flowState.state !== "generating") {
    return (
      <StateView
        flowState={flowState}
        actions={actions}
        onUseManifest={onUseManifest}
        onConfirmAndContinue={handleRetryOrRegenerate}
        onRegenerate={handleRetryOrRegenerate}
        onRetryFromError={handleRetryOrRegenerate}
        onYamlChange={(yaml) => actions.saveGenerationResult(yaml)}
        externalActiveTab={previewActiveTab}
        onTabChange={setPreviewActiveTab}
      />
    );
  }

  const engineStatus = llmContext.engineState.status;
  const isModelLoading =
    engineStatus === "downloading" ||
    (engineStatus === "loading_vram" && !llmContext.engineState.autoLoading);
  const isModelError = engineStatus === "error";

  const isGenerating = flowState.state === "generating";
  const hasError = stagedGen.generationError !== null;

  return (
    <GenerateWithAiLayout>
      <HeaderSection
        title="Project with AI"
        subtitle="Describe what you want to build. The more context you provide, the better the result."
      />

      <DescriptionInput
        value={formState.description}
        onChange={(value) => {
          formHandlers.setValue("description", value);
          formHandlers.setValue("selectedExample", null);
        }}
        charCount={formHandlers.charCount}
        disabled={isGenerating}
        isAiReady={hasAnyProvider}
      />

      {hasError && (
        <div className="p-4 bg-destructive/10 border border-destructive rounded-md space-y-3">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex-1">
              <h3 className="font-semibold text-destructive text-sm">
                Generation Failed
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {stagedGen.generationError}
              </p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => handleRetryOrRegenerate()}
              className="text-sm font-medium px-3 py-1 text-destructive hover:bg-destructive/10 rounded transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                stagedGen.reset();
                formHandlers.reset();
              }}
              className="text-sm font-medium px-3 py-1 text-muted-foreground hover:bg-muted rounded transition-colors"
            >
              Clear & Start Over
            </button>
          </div>
        </div>
      )}

      <ExampleCardsSection
        selectedExample={formState.selectedExample}
        onUseExample={(example, index) => {
          formHandlers.setValue("description", example);
          formHandlers.setValue("selectedExample", index);
        }}
        isDisabled={isGenerating}
      />

      <AdvancedOptionsSection
        deployment={formState.deployment}
        onDeploymentChange={(value) =>
          formHandlers.setValue("deployment", value)
        }
        maxContexts={formState.maxContexts}
        onMaxContextsChange={(value) =>
          formHandlers.setValue("maxContexts", value)
        }
        isDisabled={isGenerating}
        onChangeModel={() => navigateToModelSelection(false)}
      />

      <ModelCapabilityCheck
        modelNativelyCapable={
          capability.isCapable && !capability.reason.includes("Override")
        }
        manifestCapable={manifestCapable}
        loadedModelId={loadedModelId}
        overrideModelCheck={overrideModelCheck}
        onOverrideChange={setOverrideModelCheck}
        onSwitchModel={() => navigateToModelSelection(false)}
      />

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
                onCancel={() => navigateToModelSelection(false)}
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

      {isGenerating && (
        <ThinkingBlock
          phase={stagedGen.phase}
          stepDetail={stagedGen.stepDetail}
          stageProgress={stagedGen.stageProgress}
        />
      )}

      <ActionBar
        canGenerate={canGenerate && !hasError}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
        onCancel={() => {
          actions.clearError();
          stagedGen.reset();
        }}
        disabledTooltip={disabledTooltip}
      />
    </GenerateWithAiLayout>
  );
}
