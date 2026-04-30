/**
 * Welcome screen for manifest generation from natural language
 */

"use client";

import { useState } from "react";
import {
  Button,
  Textarea,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Label,
} from "@hexagen/ui";
import { useManifestGeneration } from "./useManifestGeneration";
import { ERROR_MESSAGES } from "./errorMessages";
import { ManifestPreview } from "./ManifestPreview";

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

const EXAMPLE_DESCRIPTIONS = [
  "A task management system with user authentication, project boards, and real-time collaboration features",
  "An e-commerce platform with product catalog, shopping cart, payment processing, and order management",
  "A blog platform with content management, user comments, and social sharing capabilities",
];

interface WelcomeScreenProps {
  onUseManifest?: (manifest: string) => void;
}

export function WelcomeScreen({ onUseManifest }: WelcomeScreenProps) {
  const [description, setDescription] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [platform, setPlatform] = useState("");
  const [deployment, setDeployment] = useState("");

  const generation = useManifestGeneration();

  const charCount = description.length;
  const isValid = charCount >= MIN_LENGTH && charCount <= MAX_LENGTH;
  const canGenerate = isValid && !generation.isGenerating;

  const handleGenerate = () => {
    if (!canGenerate) return;

    generation.generate(description, {
      platform: platform || undefined,
      deployment: deployment || undefined,
    });
  };

  const handleUseExample = (example: string) => {
    setDescription(example);
  };

  const handleReset = () => {
    generation.reset();
    setDescription("");
    setPlatform("");
    setDeployment("");
  };

  // Show preview if generation succeeded
  if (generation.isSuccess && generation.result) {
    return (
      <ManifestPreview
        manifest={generation.result.manifest}
        confidence={generation.result.confidence}
        suggestions={generation.result.suggestions}
        warnings={generation.result.warnings}
        metadata={generation.result.metadata}
        onUseManifest={onUseManifest}
        onRegenerate={handleReset}
      />
    );
  }

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
                disabled={generation.isGenerating}
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
                    disabled={generation.isGenerating}
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
                disabled={generation.isGenerating}
                aria-expanded={showAdvanced}
                aria-controls="advanced-options-panel"
              >
                {showAdvanced ? "▼" : "▶"} Advanced Options
              </Button>

              {showAdvanced && (
                <div id="advanced-options-panel" className="space-y-3 pl-4 border-l-2 border-border">
                  <div className="space-y-1">
                    <Label htmlFor="platform">Platform (optional)</Label>
                    <input
                      id="platform"
                      type="text"
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                      placeholder="e.g., Node.js, Python, Java"
                      className="w-full px-3 py-2 border rounded-md"
                      disabled={generation.isGenerating}
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
                      disabled={generation.isGenerating}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Error Display */}
            {generation.isError && generation.errorCategory && (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md flex flex-col gap-3" role="alert">
                <p className="text-sm text-destructive">
                  <strong>{generation.errorCategory === "NETWORK" ? "Connection Error:" : "Error:"}</strong> {ERROR_MESSAGES[generation.errorCategory] || generation.error}
                </p>
                {["NETWORK", "TIMEOUT", "RATE_LIMIT"].includes(generation.errorCategory) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={handleGenerate}
                    disabled={generation.isGenerating}
                  >
                    Try Again
                  </Button>
                )}
              </div>
            )}
            {generation.isError && !generation.errorCategory && generation.error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md" role="alert">
                <p className="text-sm text-destructive">
                  <strong>Error:</strong> {generation.error}
                </p>
              </div>
            )}

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full"
              size="lg"
            >
              {generation.isGenerating ? (
                <>
                  <span className="animate-spin mr-2" aria-hidden="true">⏳</span>
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
