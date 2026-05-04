/**
 * Welcome screen composition root for manifest generation.
 * Orchestrates sub-components and state synchronization.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useWelcomeFlowState } from "../ModelSelectionFlow/useWelcomeFlowState";
import { useClientManifestGeneration } from "../useClientManifestGeneration";
import { getModelPreferences } from "../ModelSelectionFlow/modelPreferencesStorage";
import { isManifestCapableModel } from "@hexagen/local-llm";
import type { DomainModelId } from "../../../lib/llm-interfaces";
import { HeaderSection } from "./HeaderSection";
import { FormSection } from "./FormSection";
import { ModelCapabilityCheck } from "./ModelCapabilityCheck";
import { ActionBar } from "./ActionBar";
import { StateView } from "./StateView";
import { ThinkingBlock } from "./ThinkingBlock";
import { ModelSelectionView } from "./ModelSelectionView";
import { WelcomeScreenLayout } from "./WelcomeScreenLayout";
import { useWelcomeScreenForm } from "./hooks/useWelcomeScreenForm";
import type { WelcomeScreenProps } from "./types";

export function WelcomeScreen({
  onUseManifest,
  llmContext,
  onGeneratingStateChange,
}: WelcomeScreenProps) {
  // Form state management
  const [formState, formHandlers] = useWelcomeScreenForm();
  const [rememberChoice, setRememberChoice] = useState(false);
  const [overrideModelCheck, setOverrideModelCheck] = useState(false);
  const rememberChoiceRef = useRef(false);
  const clientGenAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    rememberChoiceRef.current = rememberChoice;
  }, [rememberChoice]);

  // Flow state machine
  const [flowState, actions] = useWelcomeFlowState(llmContext);
  const clientGen = useClientManifestGeneration(llmContext);

  // Notify parent of generating state
  useEffect(() => {
    onGeneratingStateChange?.(flowState.state === "generating");
  }, [flowState.state, onGeneratingStateChange]);

  // Setup generation trigger
  const generateManifestRef = useRef(clientGen.generateManifest);
  useEffect(() => {
    generateManifestRef.current = clientGen.generateManifest;
  }, [clientGen.generateManifest]);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    const controller = new AbortController();
    clientGenAbortRef.current = controller;
    generateManifestRef.current(
      formState.description,
      clientGenAbortRef.current?.signal,
    );
    return () => {
      controller.abort();
      clientGenAbortRef.current = null;
    };
  }, [flowState.state, formState.description]);

  // React to generation results
  useEffect(() => {
    if (flowState.state !== "generating") return;
    if (clientGen.generationError) {
      const err = clientGen.generationError;
      const isYamlError = err.startsWith(
        "Generated manifest has invalid YAML:",
      );
      if (isYamlError) {
        actions.setError(
          "The AI produced malformed YAML. Please try again with a shorter description, or click Retry.",
          "yaml_validation_failed",
        );
      } else {
        const code: "inference_failed" | "no_yaml_extracted" = err.includes(
          "did not contain a valid manifest",
        )
          ? "no_yaml_extracted"
          : "inference_failed";
        actions.setError(err, code);
      }
    }
  }, [clientGen.generationError, flowState.state, actions]);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    if (clientGen.generatedManifest) {
      actions.saveGenerationResult(clientGen.generatedManifest);
    }
  }, [clientGen.generatedManifest, flowState.state, actions]);

  // Sync clarification phase
  useEffect(() => {
    if (
      clientGen.phase === "clarification_needed" &&
      flowState.state === "generating" &&
      clientGen.clarificationTriggers.length > 0
    ) {
      actions.setClarificationNeeded(clientGen.clarificationTriggers);
    }
  }, [
    clientGen.phase,
    clientGen.clarificationTriggers,
    flowState.state,
    actions,
  ]);

  // Setup confirmation continuations
  const confirmRef = useRef(clientGen.confirmTopologyAndContinue);
  useEffect(() => {
    confirmRef.current = clientGen.confirmTopologyAndContinue;
  }, [clientGen.confirmTopologyAndContinue]);

  const confirmAndContinueRef = useRef(actions.confirmAndContinue);
  useEffect(() => {
    confirmAndContinueRef.current = actions.confirmAndContinue;
  }, [actions.confirmAndContinue]);

  useEffect(() => {
    if (
      flowState.state === "generating" &&
      clientGen.phase === "clarification_needed" &&
      clientGen.partialTopology !== null
    ) {
      confirmRef.current(clientGenAbortRef.current?.signal);
    }
  }, [flowState.state, clientGen.phase, clientGen.partialTopology]);

  // Model capability checks
  const loadedModelId = llmContext.engineState.loadedModelId;
  const modelNativelyCapable =
    !loadedModelId || isManifestCapableModel(loadedModelId);
  const manifestCapable = modelNativelyCapable || overrideModelCheck;

  useEffect(() => {
    if (modelNativelyCapable) setOverrideModelCheck(false);
  }, [modelNativelyCapable]);

  const canGenerate =
    formHandlers.isValid && flowState.state === "idle" && manifestCapable;

  // Event handlers
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

  const handleRegenerate = () => {
    if (clientGenAbortRef.current) {
      clientGenAbortRef.current.abort();
      clientGenAbortRef.current = null;
    }
    clientGen.reset();
    actions.regenerateManifest();
  };

  const handleRetryFromError = () => {
    if (clientGenAbortRef.current) {
      clientGenAbortRef.current.abort();
      clientGenAbortRef.current = null;
    }
    clientGen.reset();
    actions.regenerateManifest();
  };

  const handleConfirmAndContinue = () => {
    actions.confirmAndContinue();
  };

  // Conditional state views (non-idle, non-generating, non-model_selection)
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
        onConfirmAndContinue={handleConfirmAndContinue}
        onRegenerate={handleRegenerate}
        onRetryFromError={handleRetryFromError}
      />
    );
  }

  // Model selection view
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
      <HeaderSection
        title="Welcome to HexaGen Monaco"
        subtitle="Describe your project in natural language to generate a clean, scalable hexagonal architecture manifest."
      />

      <FormSection
        description={formState.description}
        onDescriptionChange={(value) =>
          formHandlers.setValue("description", value)
        }
        platform={formState.platform}
        onPlatformChange={(value) => formHandlers.setValue("platform", value)}
        deployment={formState.deployment}
        onDeploymentChange={(value) =>
          formHandlers.setValue("deployment", value)
        }
        selectedExample={formState.selectedExample}
        onUseExample={(example, index) => {
          formHandlers.setValue("description", example);
          formHandlers.setValue("selectedExample", index);
        }}
        charCount={formHandlers.charCount}
        isDisabled={isGenerating}
      />

      <ModelCapabilityCheck
        modelNativelyCapable={modelNativelyCapable}
        manifestCapable={manifestCapable}
        loadedModelId={loadedModelId}
        overrideModelCheck={overrideModelCheck}
        onOverrideChange={setOverrideModelCheck}
        onSwitchModel={() => actions.transitionTo("model_selection")}
      />

      {isGenerating && (
        <ThinkingBlock
          phase={clientGen.phase}
          stepDetail={clientGen.stepDetail}
        />
      )}

      <ActionBar
        canGenerate={canGenerate}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
        onCancel={() => actions.transitionTo("idle")}
      />
    </WelcomeScreenLayout>
  );
}
