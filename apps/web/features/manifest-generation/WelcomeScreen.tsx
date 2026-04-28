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
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100">
            Welcome to HexaGen Monaco
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">
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
                      ? "text-slate-500"
                      : charCount > MAX_LENGTH
                        ? "text-red-500"
                        : "text-green-600"
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
                className="resize-none"
                style={{ minHeight: "150px" }}
                disabled={generation.isGenerating}
              />
              {charCount < MIN_LENGTH && charCount > 0 && (
                <p className="text-sm text-slate-500">
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
              >
                {showAdvanced ? "▼" : "▶"} Advanced Options
              </Button>

              {showAdvanced && (
                <div className="space-y-3 pl-4 border-l-2 border-slate-200 dark:border-slate-700">
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
            {generation.isError && generation.error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                <p className="text-sm text-red-800 dark:text-red-200">
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
                  <span className="animate-spin mr-2">⏳</span>
                  Generating Manifest...
                </>
              ) : (
                "Generate Manifest"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Info Footer */}
        <div className="text-center text-sm text-slate-500 dark:text-slate-400">
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
