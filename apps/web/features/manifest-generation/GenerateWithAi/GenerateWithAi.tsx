"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useModelSelectionFlowState } from "../ModelSelectionFlow/useModelSelectionFlowState";
import { useStagedManifestGeneration } from "../useStagedManifestGeneration";
import { getModelPreferences } from "../ModelSelectionFlow/modelPreferencesStorage";
import { assessModelCapability } from "@hexagen/manifest-generation";
import {
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from "@hexagen/agentic-interaction";
import type { DomainModelId } from "../../../lib/llm-interfaces";
import type { LLMEngineStatus, ModelMetadata } from "@hexagen/local-llm";
import { Button } from "@hexagen/ui";
import { ModelProgressCard } from "@/governance-assistant/ModelProgressCard";
import { TextareaComposer } from "@/chat/TextareaComposer";
import { ActionBar } from "./ActionBar";
import { AiReadyIndicator } from "./AiReadyIndicator";
import { DescriptionInput } from "./DescriptionInput";
import { ExampleCardsSection } from "./ExampleCardsSection";
import { AdvancedOptionsSection } from "./AdvancedOptionsSection";
import { HeaderSection } from "./HeaderSection";
import { ModelSetupPrompt } from "./ModelSetupPrompt";
import { StateView } from "./StateView";
import { AiGeneratingStep } from "./AiGeneratingStep";
import { GenerateWithAiLayout } from "./GenerateWithAiLayout";
import { useGenerateWithAiForm } from "./hooks/useGenerateWithAiForm";
import type { GenerateWithAiProps } from "./types";
import { useLLMReadiness } from "../hooks/useLLMReadiness";
import { useModelSelectionIntent } from "../store/useModelSelectionIntent";
import {
  useExecutionEngine,
  shouldWarnBeforeGenerate,
  effectivePreferLocal,
  type ExecutionEngine,
} from "../store/useExecutionEngine";
import { LocalGenerationWarningDialog } from "../LocalGenerationWarningDialog";
import { useSuppressLLMLoadingModal } from "@/contexts/LLMLoadingModalContext";

export function GenerateWithAi({
  onUseManifest,
  llmContext,
  onGeneratingStateChange,
  renderWorkbench,
}: GenerateWithAiProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modelSelectionIntent = useModelSelectionIntent();
  useSuppressLLMLoadingModal();
  const [formState, formHandlers] = useGenerateWithAiForm();
  const [mounted, setMounted] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { isProbing, needsSetup, preferLocal, hasAnyCloud } = useLLMReadiness(
    llmContext.engineState,
  );
  const { engine, setEngine } = useExecutionEngine();
  const [showLocalWarning, setShowLocalWarning] = useState(false);

  const [flowState, actions] = useModelSelectionFlowState(llmContext);
  const stagedGen = useStagedManifestGeneration();

  const engineStatus = llmContext.engineState.status;
  const isModelLoading =
    engineStatus === "downloading" ||
    (engineStatus === "loading_vram" && !llmContext.engineState.autoLoading);
  const isModelError = engineStatus === "error";

  // Show the dedicated full-height generating screen while generation is in
  // flight AND after it completes (the flow parks here so the telemetry log
  // stays reviewable; the parent footer's Next advances to /ai/accept). Fall
  // through to the form on a generation error (its inline retry / clear UI),
  // and while the local model is still downloading or loading into VRAM (so
  // the ModelProgressCard modal below stays reachable).
  const showGeneratingScreen =
    flowState.state === "generating" &&
    !stagedGen.generationError &&
    !isModelLoading &&
    !isModelError;

  const cancelGenerationRef = useRef(() => {});
  cancelGenerationRef.current = () => {
    actions.clearError();
    stagedGen.reset();
  };

  const onUseManifestRef = useRef(onUseManifest);
  onUseManifestRef.current = onUseManifest;

  // On success the flow stays parked on the generating screen (telemetry log
  // stays reviewable); the parent footer gets a Next action that hands the
  // completed manifest to /ai/accept. While still in flight, Cancel only.
  // The truthy check is intentional, not an off-by-"" bug: the hook
  // guarantees generatedManifest is null or non-blank (empty renders are
  // normalized into generationError + phase "failed" on both the local and
  // cloud paths), and a Next that forwards "" could only fail into a parse
  // error — so an empty string must keep Next hidden, never show it.
  const completedManifest =
    !stagedGen.isGenerating && stagedGen.generatedManifest
      ? stagedGen.generatedManifest
      : null;

  useEffect(() => {
    onGeneratingStateChange?.(
      showGeneratingScreen
        ? {
            onCancel: () => cancelGenerationRef.current(),
            onNext: completedManifest
              ? () => onUseManifestRef.current?.(completedManifest)
              : undefined,
          }
        : null,
    );
  }, [showGeneratingScreen, onGeneratingStateChange, completedManifest]);

  const generateRef = useRef(stagedGen.generateManifest);
  useEffect(() => {
    generateRef.current = stagedGen.generateManifest;
  }, [stagedGen.generateManifest]);

  const stagedGenStatusRef = useRef({ isGenerating: false, hasResult: false });
  stagedGenStatusRef.current = {
    isGenerating: stagedGen.isGenerating,
    hasResult: stagedGen.generatedManifest !== null,
  };

  useEffect(() => {
    if (flowState.state !== "generating") return;
    // Parked-on-telemetry guard: the flow now stays in "generating" after a
    // successful run, so a dependency change (e.g. a late readiness probe
    // flipping preferLocal) must not relaunch generation over a completed or
    // in-flight run. Retry paths reset stagedGen first, so they pass.
    const status = stagedGenStatusRef.current;
    if (status.isGenerating || status.hasResult) return;
    generateRef.current(formState.description, {
      deployment: formState.deployment,
      signal: undefined,
      preferLocal: effectivePreferLocal(engine, preferLocal),
    });
  }, [
    flowState.state,
    formState.description,
    formState.deployment,
    preferLocal,
    engine,
  ]);

  const loadedModelId = llmContext.engineState.loadedModelId;
  const capability = assessModelCapability(loadedModelId, false);
  const manifestCapable = capability.isCapable;

  const hasAnyProvider = !needsSetup || isProbing;
  const canGenerate =
    formHandlers.isValid &&
    flowState.state === "idle" &&
    hasAnyProvider &&
    !isProbing;

  const disabledTooltip = formHandlers.isTooShort
    ? `Description must be at least ${DESCRIPTION_MIN_LENGTH} characters.`
    : formHandlers.isTooLong
      ? "Description exceeds character limit"
      : undefined;

  const navigateToModelSelection = useCallback(
    (autoGenerate = false) => {
      modelSelectionIntent.setAutoGenerate(autoGenerate);
      router.push("/projects/new/ai/models");
    },
    [modelSelectionIntent, router],
  );

  // Kicks off generation for the given strategy. Cloud goes straight to
  // generating; local first ensures a model is ready (or remembered),
  // otherwise detours through model selection with auto-generate intent.
  // For "auto" this preserves the previous hasAnyCloud gate: auto only
  // resolves local when no cloud keys exist, and reaching here without cloud
  // keys implies WebLLM hardware (needsSetup blocks canGenerate otherwise).
  const proceedWithGeneration = (strategy: ExecutionEngine) => {
    if (!effectivePreferLocal(strategy, preferLocal)) {
      actions.transitionTo("generating");
      return;
    }
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

  const handleGenerate = () => {
    if (!canGenerate) return;

    if (shouldWarnBeforeGenerate(engine)) {
      setShowLocalWarning(true);
      return;
    }
    proceedWithGeneration(engine);
  };

  const hasReturnedFromModelSelection = searchParams.get("generate") === "1";
  // Consuming the auto-start intent must strip ONLY `generate=1`: `?name=`
  // keys the genesis settings store snapshot AND becomes the saved project
  // name (AIGenerationPage's carriedName), and a parameterless replace stays
  // on the same route — no remount — so it would flip carriedName to null
  // mid-mount, mirror later Section A edits under the wrong store key, and
  // wipe them on the next accept Back/Regenerate round trip. (The /models
  // detour's return URL is owned by ModelSelectionPage and still drops the
  // name — carrying it through that hop is a disclosed follow-up.)
  const inboundName = searchParams.get("name");
  const autoStartConsumedUrl = inboundName
    ? `/projects/new/ai?name=${encodeURIComponent(inboundName)}`
    : "/projects/new/ai";

  useEffect(() => {
    if (!hasReturnedFromModelSelection) return;
    if (flowState.state !== "idle") return;
    if (!formHandlers.isValid) return;

    if (!effectivePreferLocal(engine, preferLocal)) {
      actions.transitionTo("generating");
      router.replace(autoStartConsumedUrl);
    } else {
      const prefs = getModelPreferences();
      if (
        llmContext.engineState.status === "ready" ||
        (prefs.rememberChoice && prefs.lastModelId)
      ) {
        actions.transitionTo("generating");
        router.replace(autoStartConsumedUrl);
      }
    }
  }, [
    hasReturnedFromModelSelection,
    autoStartConsumedUrl,
    flowState.state,
    formHandlers.isValid,
    llmContext.engineState.status,
    actions,
    router,
    engine,
    preferLocal,
  ]);

  const handleRetryOrRegenerate = useCallback(() => {
    setRetryCount((prev) => prev + 1);
    if (retryCount >= 3) return;
    stagedGen.reset();
    actions.regenerateManifest();
  }, [stagedGen, actions, retryCount]);

  // Plan Workbench C1: the workbench composer routes through the SAME
  // handleGenerate gate as the ActionBar button — min-length validation
  // (canGenerate ← formHandlers.isValid), the explicit-local warning dialog and
  // the /models detour are all preserved behind it. Deliberately resolves
  // `false` on every call: TextareaComposer clears its draft on `true`, but
  // here the draft IS formState.description — the generation effect reads it
  // AFTER the flow transitions, and retry/regenerate reuse it, so clearing
  // would generate from an empty description.
  const handleComposerSubmit = async (): Promise<boolean> => {
    handleGenerate();
    return false;
  };

  if (flowState.state !== "idle" && flowState.state !== "generating") {
    const stateView = (
      <StateView
        flowState={flowState}
        actions={actions}
        onConfirmAndContinue={handleRetryOrRegenerate}
        onRetryFromError={handleRetryOrRegenerate}
      />
    );
    // Workbench mode: flow-state screens (setup/error interstitials) fill the
    // right pane's main slot, as today (§3.6) — no composer alongside them.
    if (renderWorkbench) {
      return renderWorkbench({
        main: <div className="h-full overflow-y-auto">{stateView}</div>,
      });
    }
    return stateView;
  }

  // Replace the form with the dedicated full-height generating screen (mirrors
  // the import flow). See showGeneratingScreen above for exactly when.
  if (showGeneratingScreen) {
    const generatingScreen = (
      <div className="h-full flex flex-col dot-grid bg-ambient p-4">
        <AiGeneratingStep
          phase={stagedGen.phase}
          stepDetail={stagedGen.stepDetail}
          stageProgress={stagedGen.stageProgress}
          verboseLog={stagedGen.verboseLog}
        />
      </div>
    );
    // Workbench mode: the telemetry/progress log IS the main view while the
    // run is in flight and after it parks (no composer — the shell footer's
    // explicit Next advances; deliberately no router.push from the success
    // arm, per the parked-on-telemetry contract above).
    if (renderWorkbench) {
      return renderWorkbench({ main: generatingScreen });
    }
    return generatingScreen;
  }

  const isGenerating = flowState.state === "generating";
  const hasError = stagedGen.generationError !== null;

  // ── Form-era sections, shared verbatim by both layouts ────────────────────
  // (single-column below, workbench right-pane when renderWorkbench is set).

  const setupPrompt = needsSetup && !isProbing && (
    <ModelSetupPrompt onSetupModel={() => navigateToModelSelection(false)} />
  );

  const errorSection = hasError && (
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
          {retryCount >= 3 && (
            <p className="text-sm text-destructive mt-2">
              Maximum retry attempts reached. Please check your connection or
              try again later.
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => handleRetryOrRegenerate()}
          disabled={retryCount >= 3}
          className="text-sm font-medium px-3 py-1 text-destructive hover:bg-destructive/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Try Again ({3 - retryCount} attempts left)
        </button>
        <button
          onClick={() => {
            stagedGen.reset();
            formHandlers.reset();
            setRetryCount(0);
          }}
          className="text-sm font-medium px-3 py-1 text-muted-foreground hover:bg-muted rounded transition-colors"
        >
          Clear & Start Over
        </button>
      </div>
    </div>
  );

  const exampleCards = (
    <ExampleCardsSection
      selectedExample={formState.selectedExample}
      onUseExample={(example, index) => {
        formHandlers.setValue("description", example);
        formHandlers.setValue("selectedExample", index);
      }}
      isDisabled={isGenerating}
    />
  );

  const advancedOptions = (
    <AdvancedOptionsSection
      deployment={formState.deployment}
      onDeploymentChange={(value) => formHandlers.setValue("deployment", value)}
      maxContexts={formState.maxContexts}
      onMaxContextsChange={(value) =>
        formHandlers.setValue("maxContexts", value)
      }
      isDisabled={isGenerating}
      onChangeModel={() => navigateToModelSelection(false)}
      engine={engine}
      onEngineChange={setEngine}
    />
  );

  const capabilityWarning = !manifestCapable && loadedModelId && (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium text-amber-600 dark:text-amber-400">
        Model may produce unreliable results
      </p>
      <p className="mt-1 text-muted-foreground">
        The current model may not reliably produce structured JSON. For best
        results, use a 3B+ parameter model.
      </p>
      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigateToModelSelection(false)}
        >
          Switch to 3B+ Model
        </Button>
      </div>
    </div>
  );

  // Portal to document.body — tree placement is irrelevant, so both layouts
  // can include it wherever convenient.
  const modelLoadingPortal =
    mounted &&
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
        <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
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
              llmContext.engineState.loadedModelId as DomainModelId | undefined
            }
          />
        </div>
      </div>,
      document.body,
    );

  const localWarningDialog = (
    <LocalGenerationWarningDialog
      open={showLocalWarning}
      onOpenChange={setShowLocalWarning}
      onContinueLocal={() => {
        setShowLocalWarning(false);
        proceedWithGeneration("local");
      }}
      onSwitchToCloud={() => {
        setShowLocalWarning(false);
        // Same-handler setEngine + transition is safe: React batches both,
        // so the generation effect runs with engine === "cloud".
        setEngine("cloud");
        proceedWithGeneration("cloud");
      }}
      canSwitchToCloud={hasAnyCloud}
    />
  );

  // ── Workbench layout (Plan Workbench C1) ──────────────────────────────────
  // DescriptionInput is replaced by the bottom-pinned composer; every other
  // section keeps today's placement in the main body (Generation-options /
  // example-cards relocation is PR C2, per the settled scope). The submit
  // affordance moves from the ActionBar into the composer — rendering both
  // would duplicate the Generate action.
  if (renderWorkbench) {
    return renderWorkbench({
      main: (
        <div className="h-full overflow-y-auto dot-grid">
          <div className="max-w-2xl mx-auto w-full px-6 py-8 space-y-8">
            <HeaderSection
              title="Project with AI"
              subtitle="Describe what you want to build. The more context you provide, the better the result."
            />
            {setupPrompt}
            {errorSection}
            {exampleCards}
            {advancedOptions}
            {capabilityWarning}
          </div>
          {modelLoadingPortal}
          {localWarningDialog}
        </div>
      ),
      composer: (
        <div className="shrink-0">
          <TextareaComposer
            value={formState.description}
            onValueChange={(value) => {
              formHandlers.setValue("description", value);
              formHandlers.setValue("selectedExample", null);
            }}
            onSubmit={handleComposerSubmit}
            placeholder="Describe your project in detail... e.g., A task management system with user authentication, project boards, and real-time collaboration features..."
            inputAriaLabel="Project description"
            submitLabel="Generate"
            // Mirrors the ActionBar gate exactly (canGenerate && !hasError).
            // TextareaComposer keeps the textarea editable when disabled — it
            // only blocks submit — so the user can keep drafting while short,
            // probing, or in the error state.
            disabled={!canGenerate || hasError}
          />
          <div className="flex items-center justify-between px-4 pb-2">
            <AiReadyIndicator isReady={hasAnyProvider} />
            {/* aria-atomic keeps parity with the DescriptionInput counter this
                caption row replaced: the counter/limit copy swaps wholesale,
                so screen readers must re-announce the whole region. */}
            <p
              className="text-xs"
              aria-live="polite"
              aria-atomic="true"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {disabledTooltip ? (
                <span className="text-amber-600">{disabledTooltip}</span>
              ) : (
                <span className="text-muted-foreground">
                  {formHandlers.charCount.toLocaleString()} /{" "}
                  {DESCRIPTION_MAX_LENGTH.toLocaleString()}
                </span>
              )}
            </p>
          </div>
        </div>
      ),
    });
  }

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

      {setupPrompt}

      {errorSection}

      {exampleCards}

      {advancedOptions}

      {capabilityWarning}

      {modelLoadingPortal}

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

      {localWarningDialog}
    </GenerateWithAiLayout>
  );
}
