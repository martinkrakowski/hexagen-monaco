"use client";

import { useState, useEffect } from "react";
import { useLocalLLMConfig } from "@/llm-driver/useLocalLlm";
import { getCapabilities } from "@/lib/manifest-generation";
import { isFreeTierModel } from "../../wire.client";
import { usePreferredLLM } from "../store/usePreferredLLM";

export function useCurrentModelName(): string | null {
  const [modelName, setModelName] = useState<string | null>(null);
  const llmConfig = useLocalLLMConfig();
  const { preferredLocalModel } = usePreferredLLM();
  const isFreeTier = isFreeTierModel();

  useEffect(() => {
    const updateModelName = async () => {
      // If a local model is preferred and loaded, show its name
      if (preferredLocalModel && llmConfig.loadedModel?.name) {
        setModelName(llmConfig.loadedModel.name);
        return;
      }

      // If a local model is preferred but not yet loaded, extract name from ID
      if (preferredLocalModel) {
        const modelDisplayName = preferredLocalModel
          .split("/")
          .pop()
          ?.replace(/-/g, " ");
        if (modelDisplayName) {
          setModelName(modelDisplayName);
          return;
        }
      }

      // Clear stale name immediately before the async fetch
      setModelName(null);

      // Otherwise, get the cloud model name
      try {
        const capabilities = await getCapabilities();
        if (capabilities.activeModelName) {
          setModelName(capabilities.activeModelName);
          return;
        }
      } catch {
        // Ignore errors
      }

      // Default to free tier if using cloud
      if (isFreeTier) {
        setModelName("Free Tier Model");
      }
    };

    updateModelName();
  }, [llmConfig.loadedModel, preferredLocalModel, isFreeTier]);

  return modelName;
}
