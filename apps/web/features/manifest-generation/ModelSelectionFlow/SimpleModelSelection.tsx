"use client";

import { useState } from "react";
import { Button, CardContent } from "@hexagen/ui";
import type { DomainModelId } from "@hexagen/local-llm";
import type {
  ModelSelectionFlowState,
  ModelSelectionFlowActions,
} from "./useModelSelectionFlowState";

interface SimpleModelSelectionProps {
  selectLocalModel: ModelSelectionFlowActions["selectLocalModel"];
  selectCloudProvider: ModelSelectionFlowActions["selectCloudProvider"];
  cancelModelDownload: ModelSelectionFlowActions["cancelModelDownload"];
  flowState: ModelSelectionFlowState;
}

export function SimpleModelSelection({
  selectLocalModel,
  selectCloudProvider,
  cancelModelDownload,
  flowState,
}: SimpleModelSelectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const isWebGPUSupported =
    flowState.hardwareCapabilities?.isWebGPUSupported ?? null;

  const handleSelectCloud = async () => {
    setIsLoading(true);
    try {
      // Use default cloud provider (adjust provider/key as needed)
      await selectCloudProvider("openai", "", false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectLocalModel = async () => {
    setIsLoading(true);
    try {
      // Use default local model ID (phi-3-mini as default)
      const defaultLocalModelId = "phi-3-mini-4k-instruct-q4" as DomainModelId;
      await selectLocalModel(defaultLocalModelId, true);
    } finally {
      setIsLoading(false);
    }
  };

  // Show download progress if in model_downloading state
  if (flowState.state === "model_downloading") {
    return (
      <CardContent className="p-6 space-y-4">
        <h3 className="text-lg font-medium mb-2">Downloading Model</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Downloading local AI model, please wait...
        </p>
        <div className="w-full bg-muted rounded-full h-2.5">
          <div
            className="bg-primary h-2.5 rounded-full transition-all duration-300"
            style={{ width: `${flowState.generationProgress || 0}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground text-center">
          {Math.round(flowState.generationProgress || 0)}% complete
        </p>
        <Button
          variant="outline"
          onClick={cancelModelDownload}
          className="w-full"
        >
          Cancel Download
        </Button>
      </CardContent>
    );
  }

  // Show key validation state
  if (flowState.state === "key_validation") {
    return (
      <CardContent className="p-6 space-y-4 text-center">
        <h3 className="text-lg font-medium mb-2">Validating API Key</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Please wait while we validate your API key...
        </p>
        <div className="flex justify-center">
          <span className="animate-spin text-2xl">⏳</span>
        </div>
      </CardContent>
    );
  }

  return (
    <CardContent className="p-6 space-y-4">
      <h3 className="text-lg font-medium mb-2">Model Selection</h3>

      <p className="text-sm text-muted-foreground mb-4">
        Choose an AI model for generating your hexagonal architecture manifest.
      </p>

      <div className="flex flex-col space-y-2">
        <div className="p-4 border rounded-md hover:bg-accent/10 transition-colors">
          <h4 className="font-medium">Cloud Model</h4>
          <p className="text-sm text-muted-foreground mb-2">
            Uses a cloud API to generate manifests. Great for complex projects.
          </p>
          <Button
            onClick={handleSelectCloud}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? "Setting up..." : "Use Cloud Model"}
          </Button>
        </div>

        <div className="p-4 border rounded-md hover:bg-accent/10 transition-colors">
          <h4 className="font-medium">
            Local Model{" "}
            {isWebGPUSupported === false ? "(Browser Not Supported)" : ""}
          </h4>
          <p className="text-sm text-muted-foreground mb-2">
            Run AI locally in your browser. Better privacy, works offline.
          </p>
          {isWebGPUSupported === false ? (
            <div className="text-xs text-amber-600 mb-2">
              Your browser doesn't support WebGPU. Try Chrome or Edge browser
              for local AI.
            </div>
          ) : null}
          <Button
            variant="outline"
            disabled={isWebGPUSupported === false || isLoading}
            className="w-full"
            onClick={handleSelectLocalModel}
          >
            {isLoading ? "Setting up..." : "Use Local Model"}
          </Button>
        </div>
      </div>

      <div className="flex justify-between mt-4 pt-4 border-t">
        <Button variant="outline" onClick={cancelModelDownload}>
          Cancel
        </Button>
        <p className="text-xs text-muted-foreground self-center">
          Your privacy is important to us. No data is stored externally.
        </p>
      </div>
    </CardContent>
  );
}
