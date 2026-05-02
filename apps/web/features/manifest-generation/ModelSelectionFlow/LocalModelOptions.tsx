"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@hexagen/ui";
import type { DomainModelId } from "@hexagen/local-llm";

interface LocalModelOptionsProps {
  onSelect: (modelId: DomainModelId) => void;
}

// Mock data until we can integrate with the real model catalog
const MODEL_OPTIONS = [
  {
    id: "phi-3-mini-4k-instruct-q4",
    name: "Phi-3 Mini",
    description: "Balanced model for most tasks",
    downloadSize: "2.1 GB",
    tier: "desktop-compact",
    recommended: true,
  },
  {
    id: "llama-3-1b-instruct-q4",
    name: "Llama 3 (1B)",
    description: "Lightweight model for basic tasks",
    downloadSize: "0.8 GB",
    tier: "ultra-light",
    recommended: false,
  },
  {
    id: "gemma-2b-it-q4",
    name: "Gemma 2B",
    description: "Good balance of size and capability",
    downloadSize: "1.2 GB",
    tier: "desktop-compact",
    recommended: false,
  },
];

export function LocalModelOptions({ onSelect }: LocalModelOptionsProps) {
  const [isWebGPUSupported, setIsWebGPUSupported] = useState<boolean | null>(
    null,
  );

  // Check WebGPU support on mount
  useEffect(() => {
    const checkWebGPU = async () => {
      try {
        // Check if WebGPU is available in this browser
        if (typeof navigator !== "undefined" && "gpu" in navigator) {
          try {
            // @ts-expect-error - TypeScript may not have updated types for WebGPU
            const adapter = await navigator.gpu.requestAdapter();
            setIsWebGPUSupported(!!adapter);
          } catch {
            setIsWebGPUSupported(false);
          }
        } else {
          setIsWebGPUSupported(false);
        }
      } catch {
        setIsWebGPUSupported(false);
      }
    };

    checkWebGPU();
  }, []);

  const handleSelect = (modelId: DomainModelId) => {
    onSelect(modelId);
  };

  if (isWebGPUSupported === false) {
    return (
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md">
        <h3 className="text-sm font-medium text-amber-800">
          WebGPU Not Supported
        </h3>
        <p className="text-sm text-amber-700 mt-1">
          Your browser doesn't support WebGPU, which is required for local
          models. Try using a recent version of Chrome or Edge, or use a cloud
          provider instead.
        </p>
        <p className="text-sm mt-2">
          <a
            href="https://developer.chrome.com/docs/web-platform/webgpu/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Learn more about WebGPU support
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        {MODEL_OPTIONS.map((model) => (
          <Card
            key={model.id}
            className={`cursor-pointer hover:bg-accent/50 transition-colors ${
              model.recommended ? "border-primary/50" : ""
            }`}
            onClick={() => handleSelect(model.id as DomainModelId)}
          >
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium mb-1">
                    {model.name}
                    {model.recommended && (
                      <span className="ml-2 text-xs text-primary">
                        (Recommended)
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {model.description}
                  </p>
                </div>
                <span className="text-sm bg-muted px-2 py-1 rounded-md">
                  {model.downloadSize}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
