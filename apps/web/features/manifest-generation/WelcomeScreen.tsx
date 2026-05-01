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
} from "@hexagen/ui";
import { useWelcomeFlowState } from "./ModelSelectionFlow/useWelcomeFlowState";
import { useClientManifestGeneration } from "./useClientManifestGeneration";
import { WELCOME_FLOW_ERROR_MESSAGES } from "./ModelSelectionFlow/WelcomeFlowError";
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
  const [preferLocal, setPreferLocal] = useState(false);
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

  // Handle manifest generation when in generating state
  useEffect(() => {
    if (flowState.state !== "generating") return;

    // Phase 7: Use client-side generation for local models
    if (preferLocal) {
      const controller = new AbortController();
      clientGenAbortRef.current = controller;
      clientGen.generateManifest(description);
      return () => {
        controller.abort();
        clientGenAbortRef.current = null;
      };
    }

    // Server-side generation path (cloud or server-side local)
    const controller = new AbortController();

    const generateManifest = async () => {
      try {
        const response = await fetch("/api/manifest/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            platform: platform || undefined,
            deployment: deployment || undefined,
            modelId: flowState.selectedModelId,
          }),
          signal: controller.signal,
        });

        const data = await response.json();
        if (data.success) {
          actions.saveGenerationResult(data.manifest);
        } else {
          actions.setError(
            data.error || "Failed to generate manifest",
            "inference_failed",
          );
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          actions.setError(
            error.message || "Failed to generate manifest",
            "network_failure",
          );
        }
      }
    };

    generateManifest();
    return () => controller.abort();
  }, [
    flowState.state,
    description,
    platform,
    deployment,
    flowState.selectedModelId,
    preferLocal,
    actions,
    clientGen.generateManifest,
  ]);

  // Phase 7: React to client-side generation results
  useEffect(() => {
    if (flowState.state !== "generating" || !preferLocal) return;
    if (clientGen.generationError) {
      actions.setError(clientGen.generationError, "inference_failed");
    }
  }, [clientGen.generationError, flowState.state, preferLocal, actions]);

  useEffect(() => {
    if (flowState.state !== "generating" || !preferLocal) return;
    if (clientGen.generatedManifest) {
      actions.saveGenerationResult(clientGen.generatedManifest);
    }
  }, [clientGen.generatedManifest, flowState.state, preferLocal, actions]);

  const handleGenerate = () => {
    if (!canGenerate) return;

    if (preferLocal) {
      actions.transitionTo("model_selection");
    } else {
      actions.transitionTo("generating");
    }
  };

  const handleUseExample = (example: string) => {
    setDescription(example);
  };

  const handleRegenerate = () => {
    // Cancel any in-flight client generation
    if (clientGenAbortRef.current) {
      clientGenAbortRef.current.abort();
      clientGenAbortRef.current = null;
    }
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
            <Button onClick={actions.retryGeneration}>Retry</Button>
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
              setPreferLocal(false);
              setRememberChoice(false);
              actions.transitionTo("idle");
            }}
          >
            Use Cloud Model Instead
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
              onDeleteModel={async () => {}}
              hasModelInCache={async () => false}
              onBack={() => actions.transitionTo("idle")}
              isLoading={
                llmContext.engineState.status === "downloading" ||
                llmContext.engineState.status === "loading_vram"
              }
              onSwitchToCloud={() =>
                actions.selectCloudProvider("openai", "", false)
              }
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
              <input
                id="remember-choice"
                type="checkbox"
                checked={rememberChoice}
                onChange={(e) => setRememberChoice(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
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
                    <input
                      id="platform"
                      type="text"
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                      placeholder="e.g., Node.js, Python, Java"
                      className="w-full px-3 py-2 border rounded-md"
                      disabled={flowState.state !== "idle"}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="deployment">Deployment (optional)</Label>
                    <input
                      id="deployment"
                      type="text"
                      value={deployment}
                      onChange={(e) => setDeployment(e.target.value)}
                      placeholder="e.g., AWS, Docker, Kubernetes"
                      className="w-full px-3 py-2 border rounded-md"
                      disabled={flowState.state !== "idle"}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="preferLocal">Model Preference</Label>
                    <div className="flex items-center space-x-2">
                      <input
                        id="preferLocal"
                        type="checkbox"
                        checked={preferLocal}
                        onChange={(e) => setPreferLocal(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                        disabled={flowState.state !== "idle"}
                      />
                      <Label
                        htmlFor="preferLocal"
                        className="cursor-pointer text-sm font-normal"
                      >
                        Prefer local model (if available)
                      </Label>
                    </div>
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
