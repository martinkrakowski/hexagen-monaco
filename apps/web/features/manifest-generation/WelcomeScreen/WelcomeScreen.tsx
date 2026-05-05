/**
 * Welcome screen composition root for manifest generation.
 * Orchestrates sub-components and state synchronization.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { useWelcomeFlowState } from "../ModelSelectionFlow/useWelcomeFlowState";
import { useClientManifestGeneration } from "../useClientManifestGeneration";
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
  const clientGenAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    rememberChoiceRef.current = rememberChoice;
  }, [rememberChoice]);

  const [flowState, actions] = useWelcomeFlowState(llmContext);
  const clientGen = useClientManifestGeneration(llmContext);

  useEffect(() => {
    onGeneratingStateChange?.(flowState.state === "generating");
  }, [flowState.state, onGeneratingStateChange]);

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
      formState.maxContexts,
    );
    return () => {
      controller.abort();
      clientGenAbortRef.current = null;
    };
  }, [flowState.state, formState.description, formState.maxContexts]);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    if (clientGen.generationError) {
      actions.setError(clientGen.generationError);
    }
  }, [clientGen.generationError, flowState.state, actions]);

  useEffect(() => {
    if (flowState.state !== "generating") return;
    if (clientGen.generatedManifest) {
      actions.saveGenerationResult(clientGen.generatedManifest);
    }
  }, [clientGen.generatedManifest, flowState.state, actions]);

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

  const loadedModelId = llmContext.engineState.loadedModelId;
  const capability = assessModelCapability(loadedModelId, overrideModelCheck);
  const manifestCapable = capability.isCapable;

  useEffect(() => {
    if (capability.isCapable && !capability.reason.includes("Override")) {
      setOverrideModelCheck(false);
    }
  }, [capability]);

  const canGenerate =
    formHandlers.isValid && flowState.state === "idle" && manifestCapable;

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
        onCancel={() => actions.transitionTo("idle")}
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
          phase={clientGen.phase}
          stepDetail={clientGen.stepDetail}
        />
      )}

      <div className="my-2 border-t border-border" />

      <PreviousProjectsSection onLoadProject={onLoadProject} />
    </WelcomeScreenLayout>
  );
}
