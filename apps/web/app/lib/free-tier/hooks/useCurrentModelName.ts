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
    let active = true;
    const updateModelName = async () => {
      // If a local model is preferred and loaded, show its name
      if (preferredLocalModel && llmConfig.loadedModel?.name) {
        if (active) setModelName(llmConfig.loadedModel.name);
        return;
      }

      // If a local model is preferred but not yet loaded, extract name from ID
      if (preferredLocalModel) {
        const modelDisplayName = preferredLocalModel
          .split("/")
          .pop()
          ?.replace(/-/g, " ");
        if (modelDisplayName && active) {
          setModelName(modelDisplayName);
          return;
        }
      }

      // Clear stale name immediately before the async fetch
      if (active) setModelName(null);

      // Otherwise, get the cloud model name. This hook feeds the projects
      // shell badge (e.g. /projects/new), where the truthful model is the one
      // serving manifest GENERATION — not activeModelName (LLM_MODEL), which
      // is the chat/governance model and may differ post-mercury-flip.
      try {
        const capabilities = await getCapabilities();
        const cloudModelName =
          capabilities.generationModelName ?? capabilities.activeModelName;
        if (active && cloudModelName) {
          setModelName(cloudModelName);
          return;
        }
      } catch {
        // Ignore errors
      }

      // Default to free tier if using cloud
      if (isFreeTier && active) {
        setModelName("Free Tier Model");
      }
    };

    updateModelName();
    return () => {
      active = false;
    };
  }, [llmConfig.loadedModel, preferredLocalModel, isFreeTier]);

  return modelName;
}
