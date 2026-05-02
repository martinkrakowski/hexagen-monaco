/**
 * Welcome screen for manifest generation from natural language
 */

"use client";

import { useState, useEffect, useRef } from "react";
import {
  Button,
  Textarea,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Label,
  Input,
  Checkbox,
} from "@hexagen/ui";
import { useWelcomeFlowState } from "./ModelSelectionFlow/useWelcomeFlowState";
import { useClientManifestGeneration } from "./useClientManifestGeneration";
import { WELCOME_FLOW_ERROR_MESSAGES } from "./ModelSelectionFlow/WelcomeFlowError";
import { getModelPreferences } from "./ModelSelectionFlow/modelPreferencesStorage";
import type { LocalLLMContext, DomainModelId } from "../../lib/llm-interfaces";
import { ManifestPreview } from "./ManifestPreview";
import { ModelSettingsView } from "@hexagen/model-settings";

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

const EXAMPLE_DESCRIPTIONS = [
  "A task management system with user authentication, project boards, and real-time collaboration features",
  "An e-commerce platform with product catalog, shopping cart, payment processing, and order management",
  "A blog platform with content management, user comments, and social sharing capabilities",
];

interface WelcomeScreenProps {
  onUseManifest?: (manifest: string) => void;
  llmContext: LocalLLMContext;
}

export function WelcomeScreen({
  onUseManifest,
  llmContext,
}: WelcomeScreenProps) {
  const [description, setDescription] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [platform, setPlatform] = useState("");
  const [deployment, setDeployment] = useState("");
  const [rememberChoice, setRememberChoice] = useState(false);
  const rememberChoiceRef = useRef(false);
  const clientGenAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    rememberChoiceRef.current = rememberChoice;
  }, [rememberChoice]);

  // Initialize LLM context and state machine
  const [flowState, actions] = useWelcomeFlowState(llmContext);

  // Phase 7: Client-side manifest generation for local models
  const clientGen = useClientManifestGeneration(llmContext);

  const charCount = description.length;
  const isValid = charCount >= MIN_LENGTH && charCount <= MAX_LENGTH;
  const canGenerate = isValid && flowState.state === "idle";

  const generateManifestRef = useRef(clientGen.generateManifest);
  useEffect(() => {
    generateManifestRef.current = clientGen.generateManifest;
  }, [clientGen.generateManifest]);

  useEffect(() => {
    if (flowState.state !== "generating") return;

    const controller = new AbortController();
    clientGenAbortRef.current = controller;
    generateManifestRef.current(description, clientGenAbortRef.current?.signal);
    return () => {
      controller.abort();
      clientGenAbortRef.current = null;
    };
  }, [flowState.state, description]);

  // Phase 7: React to client-side generation results
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

  const handleUseExample = (example: string) => {
    setDescription(example);
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

  // Preview state: show manifest preview
  if (flowState.state === "preview" && flowState.manifestContent) {
    return (
      <ManifestPreview
        manifest={flowState.manifestContent}
        confidence={0}
        suggestions={[]}
        warnings={[]}
        metadata={{ model: "", processingTime: 0, tokensUsed: 0 }}
        onUseManifest={onUseManifest}
        onRegenerate={handleRegenerate}
        onReject={actions.rejectManifest}
      />
    );
  }

  // Model downloading state
  if (flowState.state === "model_downloading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-background">
        <div className="w-full max-w-3xl space-y-6 text-center">
          <h1 className="text-4xl font-bold text-foreground">
            Downloading Model
          </h1>
          <p className="text-lg text-muted-foreground">
            Please wait while the local AI model is downloaded...
          </p>
          <div className="w-full max-w-md mx-auto">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${flowState.generationProgress || 0}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {Math.round(flowState.generationProgress || 0)}% complete
            </p>
          </div>
          <Button variant="ghost" onClick={actions.cancelModelDownload}>
            Cancel Download
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  if (flowState.state === "error") {
    const errorMessage = flowState.errorCode
      ? WELCOME_FLOW_ERROR_MESSAGES[flowState.errorCode]
      : flowState.error || "An unknown error occurred";

    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-background">
        <div className="w-full max-w-3xl space-y-6 text-center">
          <h1 className="text-4xl font-bold text-destructive">Error</h1>
          <p className="text-lg text-muted-foreground">{errorMessage}</p>
          <div className="flex gap-2 justify-center">
            <Button onClick={handleRetryFromError}>Retry</Button>
            {flowState.errorCode === "model_corrupted" &&
              flowState.selectedModelId && (
                <Button
                  variant="outline"
                  onClick={() =>
                    actions.repairModelDownload(
                      flowState.selectedModelId as DomainModelId,
                    )
                  }
                >
                  Repair Download
                </Button>
              )}
            <Button
              variant="ghost"
              onClick={() => actions.transitionTo("idle")}
            >
              Back to Description
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Unsupported state (WebGPU not available)
  if (flowState.state === "unsupported") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-background">
        <div className="w-full max-w-3xl space-y-6 text-center">
          <h1 className="text-4xl font-bold text-destructive">
            Unsupported Browser
          </h1>
          <p className="text-lg text-muted-foreground">
            Your browser does not support WebGPU, which is required for local AI
            models. Please use Chrome or Edge, or switch to cloud model.
          </p>
          <Button
            onClick={() => {
              actions.transitionTo("idle");
            }}
          >
            Back to Description
          </Button>
        </div>
      </div>
    );
  }

  // Key validation state
  if (flowState.state === "key_validation") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-background">
        <div className="w-full max-w-3xl space-y-6 text-center">
          <h1 className="text-4xl font-bold text-foreground">
            Validating API Key
          </h1>
          <p className="text-lg text-muted-foreground">
            Please wait while we validate your API key...
          </p>
          <div className="flex justify-center">
            <span className="animate-spin text-2xl">⏳</span>
          </div>
        </div>
      </div>
    );
  }

  // Model selection state
  if (flowState.state === "model_selection") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-background">
        <div className="w-full max-w-3xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold text-foreground">
              Welcome to HexaGen Monaco
            </h1>
            <p className="text-lg text-muted-foreground">
              Configure your AI model for manifest generation
            </p>
          </div>

          <Card className="w-full max-w-xl mx-auto my-6">
            <CardHeader>
              <CardTitle>Set Up AI Engine for Manifest Generation</CardTitle>
            </CardHeader>
            <ModelSettingsView
              currentModelId={flowState.selectedModelId ?? null}
              loadedModel={llmContext.loadedModel}
              messagesLength={0}
              onSwitchModel={async (modelId) =>
                actions.selectLocalModel(modelId, rememberChoiceRef.current)
              }
              onDeleteModel={(modelId) => llmContext.deleteCachedModel(modelId)}
              hasModelInCache={(modelId) => llmContext.hasModelInCache(modelId)}
              onBack={() => actions.transitionTo("idle")}
              isLoading={
                llmContext.engineState.status === "downloading" ||
                llmContext.engineState.status === "loading_vram"
              }
              onSwitchToCloud={undefined}
              requiresModelWarning={false}
            />
          </Card>

          {flowState.isModelReady && (
            <div className="text-center">
              <Button onClick={() => actions.transitionTo("generating")}>
                Generate Manifest
              </Button>
            </div>
          )}

          <div className="flex justify-between items-center">
            <label
              htmlFor="remember-choice"
              className="flex items-center space-x-2 cursor-pointer"
            >
              <Checkbox
                id="remember-choice"
                checked={rememberChoice}
                onCheckedChange={(checked) => setRememberChoice(checked)}
              />
              <span className="text-sm text-muted-foreground">
                Remember my choice for future sessions
              </span>
            </label>
          </div>

          <div className="text-center">
            <Button
              variant="ghost"
              onClick={() => actions.transitionTo("idle")}
            >
              Back to Description
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Default welcome screen (idle state)
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-background">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-foreground">
            Welcome to HexaGen Monaco
          </h1>
          <p className="text-lg text-muted-foreground">
            Describe your project in natural language, and we'll generate a
            complete hexagonal architecture manifest
          </p>
        </div>

        {/* Main Input Card */}
        <Card>
          <CardHeader>
            <CardTitle>Describe Your Project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Description Input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="description">Project Description</Label>
                <span
                  className={`text-sm ${
                    charCount < MIN_LENGTH
                      ? "text-muted-foreground"
                      : charCount > MAX_LENGTH
                        ? "text-destructive"
                        : "text-success"
                  }`}
                >
                  {charCount} / {MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Example: A task management system with user authentication, project boards, and real-time collaboration features..."
                className="resize-none min-h-[var(--textarea-min-height)]"
                disabled={flowState.state !== "idle"}
              />
              {charCount < MIN_LENGTH && charCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  Minimum {MIN_LENGTH} characters required
                </p>
              )}
            </div>

            {/* Example Descriptions */}
            <div className="space-y-2">
              <Label>Quick Examples</Label>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_DESCRIPTIONS.map((example, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => handleUseExample(example)}
                    disabled={flowState.state !== "idle"}
                  >
                    Example {index + 1}
                  </Button>
                ))}
              </div>
            </div>

            {/* Advanced Options */}
            <div className="space-y-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                disabled={flowState.state !== "idle"}
                aria-expanded={showAdvanced}
                aria-controls="advanced-options-panel"
              >
                {showAdvanced ? "▼" : "▶"} Advanced Options
              </Button>

              {showAdvanced && (
                <div
                  id="advanced-options-panel"
                  className="space-y-3 pl-4 border-l-2 border-border"
                >
                  <div className="space-y-1">
                    <Label htmlFor="platform">Platform (optional)</Label>
                    <Input
                      id="platform"
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                      placeholder="e.g., Node.js, Python, Java"
                      disabled={flowState.state !== "idle"}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="deployment">Deployment (optional)</Label>
                    <Input
                      id="deployment"
                      value={deployment}
                      onChange={(e) => setDeployment(e.target.value)}
                      placeholder="e.g., AWS, Docker, Kubernetes"
                      disabled={flowState.state !== "idle"}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full"
              size="lg"
            >
              {flowState.state === "generating" ? (
                <>
                  <span className="animate-spin mr-2" aria-hidden="true">
                    ⏳
                  </span>
                  <span className="sr-only">Generating manifest...</span>
                  Generating Manifest...
                </>
              ) : (
                "Generate Manifest"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Info Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>
            Your description will be analyzed using AI to identify bounded
            contexts, ports, adapters, and dependencies.
          </p>
        </div>
      </div>
    </div>
  );
}

// Made with Bob
