"use client";

import { useState, useCallback } from "react";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import { SYSTEM_PROMPT } from "@hexagen/agentic-interaction";
import { compileUserPrompt } from "@hexagen/agentic-interaction";
import { extractManifestYaml } from "@hexagen/agentic-interaction";

export interface UseClientManifestGenerationReturn {
  generateManifest: (description: string, signal?: AbortSignal) => Promise<void>;
  isGenerating: boolean;
  generationError: string | null;
  generatedManifest: string | null;
  reset: () => void;
}

export function useClientManifestGeneration(
  llmContext: LocalLLMContext,
): UseClientManifestGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(null);

  const generateManifest = useCallback(
    async (description: string, signal?: AbortSignal) => {
      if (signal?.aborted) return;

      setIsGenerating(true);
      setGenerationError(null);
      setGeneratedManifest(null);

      try {
        const userPrompt = compileUserPrompt({ userDescription: description });
        const messageCountBefore = llmContext.messages.length;
        await llmContext.sendGovernanceMessage(userPrompt, SYSTEM_PROMPT);

        if (signal?.aborted) return;

        const newMessages = llmContext.messages.slice(messageCountBefore);
        const lastAssistantMessage = newMessages
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .join("\n");

        if (signal?.aborted) return;

        const accumulatedResponse = lastAssistantMessage || "";
        const extractedYaml = extractManifestYaml(accumulatedResponse);

        if (!extractedYaml) {
          setGenerationError(
            "AI response did not contain a valid manifest YAML block",
          );
          return;
        }

        setGeneratedManifest(extractedYaml);
      } catch (error) {
        if (signal?.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate manifest client-side";
        setGenerationError(message);
      } finally {
        setIsGenerating(false);
      }
    },
    [llmContext],
  );

  const reset = useCallback(() => {
    setIsGenerating(false);
    setGenerationError(null);
    setGeneratedManifest(null);
  }, []);

  return {
    generateManifest,
    isGenerating,
    generationError,
    generatedManifest,
    reset,
  };
}