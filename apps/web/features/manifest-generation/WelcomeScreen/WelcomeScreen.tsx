"use client";

import { useState, useEffect, useRef } from "react";
import { useWelcomeFlowState } from "../ModelSelectionFlow/useWelcomeFlowState";
import { useStagedManifestGeneration } from "../useStagedManifestGeneration";
import { getModelPreferences } from "../ModelSelectionFlow/modelPreferencesStorage";
import { assessModelCapability } from "@hexagen/manifest-generation";
import type { DomainModelId } from "../../../lib/llm-interfaces";
import { ModelCapabilityCheck } from "./ModelCapabilityCheck";
import { ActionBar } from "./ActionBar";
import { EntryPointsSection } from "./EntryPointsSection";
import { PromptDivider } from "./PromptDivider";
import { DescriptionInput } from "./DescriptionInput";
import { ExampleCardsSection } from "./ExampleCardsSection";
import { AdvancedOptionsSection } from "./AdvancedOptionsSection";
import { PreviousProjectsSection } from "./PreviousProjectsSection";
import { StateView } from "./StateView";
import { ThinkingBlock } from "./ThinkingBlock";
import { ModelSelectionView } from "./ModelSelectionView";
import { WelcomeScreenLayout } from "./WelcomeScreenLayout";
import { useWelcomeScreenForm } from "./hooks/useWelcomeScreenForm";
import type { WelcomeScreenProps } from "./types";
import {
  getCapabilities,
  onCapabilityCacheInvalidated,
} from "@/lib/manifest-generation";
import { hasServerLLMAccessKey } from "../../../app/lib/wire.client";
import type { CapabilitiesResponse } from "../types/capabilities";

export function WelcomeScreen({
  onUseManifest,
  llmContext,
  onGeneratingStateChange,
  onImportManifest,
  onStartWizard,
  onLoadProject,
}: WelcomeScreenProps) {
  const [formState, formHandlers] = useWelcomeScreenForm();
  const [rememberChoice, setRememberChoice] = useState(false);
  const [overrideModelCheck, setOverrideModelCheck] = useState(false);
  const rememberChoiceRef = useRef(false);

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
  }, []);

  useEffect(() => {
    rememberChoiceRef.current = rememberChoice;
  }, [rememberChoice]);

  const [flowState, actions] = useWelcomeFlowState(llmContext);
  const stagedGen = useStagedManifestGeneration();

  useEffect(() => {
    onGeneratingStateChange?.(flowState.state === "generating");
  }, [flowState.state, onGeneratingStateChange]);

  const generateRef = useRef(stagedGen.generateManifest);
  useEffect(() => {
    generateRef.current = stagedGen.generateManifest;
  }, [stagedGen.generateManifest]);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    generateRef.current(formState.description, {
      platform: formState.platform,
      deployment: formState.deployment,
      signal: undefined,
    });
  }, [
    flowState.state,
    formState.description,
    formState.platform,
    formState.deployment,
  ]);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    if (stagedGen.generationError) {
      actions.setError(stagedGen.generationError);
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

  useEffect(() => {
    if (capability.isCapable && !capability.reason.includes("Override")) {
      setOverrideModelCheck(false);
    }
  }, [capability]);

  // Gate on both model capability AND LLM provider availability.
  // Tier 1 (sync) OR Tier 2 (async): Button enabled if either tier has keys.
  // Tier 1: env key → enabled immediately (fast-pass, don't wait for probe)
  // Tier 2: probe resolved → enabled if BYOK exists or env key exists
  // While probe in-flight: default to fail open (capabilities = undefined) so button enabled if Tier 1 passed
  const hasLlmProviders =
    hasServerApiKey || (capabilities?.canGenerate ?? false);
  const canGenerate =
    formHandlers.isValid &&
    flowState.state === "idle" &&
    manifestCapable &&
    hasLlmProviders;

  // Tooltip messaging based on which tier is unavailable
  const disabledTooltip = !hasLlmProviders
    ? "No API keys configured. Set environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, or COHERE_API_KEY) or add a BYOK key in Settings."
    : undefined;

  const handleGenerate = () => {
    if (!canGenerate) return;
    const prefs = getModelPreferences();
    if (
      llmContext.engineState.status === "ready" ||
      (prefs.rememberChoice && prefs.lastModelId)
    ) {
      actions.transitionTo("generating");
    } else {
      actions.transitionTo("model_selection");
    }
  };

  const handleRetryOrRegenerate = () => {
    stagedGen.reset();
    actions.regenerateManifest();
  };

  if (
    flowState.state !== "idle" &&
    flowState.state !== "generating" &&
    flowState.state !== "model_selection"
  ) {
    return (
      <StateView
        flowState={flowState}
        actions={actions}
        onUseManifest={onUseManifest}
        onConfirmAndContinue={handleRetryOrRegenerate}
        onRegenerate={handleRetryOrRegenerate}
        onRetryFromError={handleRetryOrRegenerate}
      />
    );
  }

  if (flowState.state === "model_selection") {
    return (
      <ModelSelectionView
        flowState={flowState}
        llmContext={llmContext}
        rememberChoice={rememberChoice}
        onRememberChoiceChange={setRememberChoice}
        onSelectModel={(modelId) =>
          actions.selectLocalModel(
            modelId as DomainModelId,
            rememberChoiceRef.current,
          )
        }
        onBack={() => actions.transitionTo("idle")}
        onModelReady={() => actions.transitionTo("generating")}
      />
    );
  }

  const isGenerating = flowState.state === "generating";

  return (
    <WelcomeScreenLayout>
      <EntryPointsSection
        onImportManifest={onImportManifest}
        onStartWizard={onStartWizard}
      />

      <PromptDivider />

      <DescriptionInput
        value={formState.description}
        onChange={(value) => formHandlers.setValue("description", value)}
        charCount={formHandlers.charCount}
        disabled={isGenerating}
      />

      <ActionBar
        canGenerate={canGenerate}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
        onCancel={() => {
          stagedGen.reset();
          actions.transitionTo("idle");
        }}
        disabledTooltip={disabledTooltip}
      />

      <ExampleCardsSection
        selectedExample={formState.selectedExample}
        onUseExample={(example, index) => {
          formHandlers.setValue("description", example);
          formHandlers.setValue("selectedExample", index);
        }}
        isDisabled={isGenerating}
      />

      <AdvancedOptionsSection
        platform={formState.platform}
        onPlatformChange={(value) => formHandlers.setValue("platform", value)}
        deployment={formState.deployment}
        onDeploymentChange={(value) =>
          formHandlers.setValue("deployment", value)
        }
        maxContexts={formState.maxContexts}
        onMaxContextsChange={(value) =>
          formHandlers.setValue("maxContexts", value)
        }
        isDisabled={isGenerating}
      />

      <ModelCapabilityCheck
        modelNativelyCapable={
          capability.isCapable && !capability.reason.includes("Override")
        }
        manifestCapable={manifestCapable}
        loadedModelId={loadedModelId}
        overrideModelCheck={overrideModelCheck}
        onOverrideChange={setOverrideModelCheck}
        onSwitchModel={() => actions.transitionTo("model_selection")}
      />

      {isGenerating && (
        <ThinkingBlock
          phase={stagedGen.phase}
          stepDetail={stagedGen.stepDetail}
          stageProgress={stagedGen.stageProgress}
        />
      )}

      <div className="my-2 border-t border-border" />

      <PreviousProjectsSection onLoadProject={onLoadProject} />
    </WelcomeScreenLayout>
  );
}
