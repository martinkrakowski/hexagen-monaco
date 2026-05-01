"use client";

import { useState, useCallback, useRef } from "react";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import { SYSTEM_PROMPT } from "@hexagen/agentic-interaction";
import { compileUserPrompt } from "@hexagen/agentic-interaction";
import { extractManifestYaml } from "@hexagen/agentic-interaction";

export interface UseClientManifestGenerationReturn {
  generateManifest: (
    description: string,
    signal?: AbortSignal,
  ) => Promise<void>;
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
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(
    null,
  );

  const messageCountBeforeRef = useRef<number | null>(null);

  const generateManifest = useCallback(
    async (description: string, signal?: AbortSignal) => {
      if (signal?.aborted) return;

      setGenerationError(null);
      setGeneratedManifest(null);
      setIsGenerating(true);

      const countBefore = llmContext.messages.length;
      messageCountBeforeRef.current = countBefore;

      try {
        const userPrompt = compileUserPrompt({ userDescription: description });
        await llmContext.sendGovernanceMessage(userPrompt, SYSTEM_PROMPT);

        if (signal?.aborted) {
          setIsGenerating(false);
          return;
        }

        // Streaming is complete, extract YAML from new messages
        const messages = llmContext.messages;
        const lastAssistantMessage = [...messages]
          .reverse()
          .find((m) => m.role === "assistant");

        const content = lastAssistantMessage?.content ?? "";

        if (!content) {
          setGenerationError(
            "AI response did not contain a valid manifest YAML block",
          );
          setIsGenerating(false);
          return;
        }

        const extractedYaml = extractManifestYaml(content);

        if (!extractedYaml) {
          setGenerationError(
            "AI response did not contain a valid manifest YAML block",
          );
          setIsGenerating(false);
          return;
        }

        setGeneratedManifest(extractedYaml);
        setIsGenerating(false);
      } catch (error) {
        if (signal?.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate manifest client-side";
        setGenerationError(message);
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
