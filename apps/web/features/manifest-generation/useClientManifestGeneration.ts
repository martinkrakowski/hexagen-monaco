"use client";

import { useState, useCallback, useRef } from "react";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import { SYSTEM_PROMPT } from "@hexagen/agentic-interaction";
import { compileUserPrompt } from "@hexagen/agentic-interaction";
import { extractManifestYaml } from "@hexagen/agentic-interaction";
import yaml from "js-yaml";

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

// Template to guide LLM YAML generation
const TEMPLATE_YAML = `workspace:
  name: # your workspace name
  description: # brief 1-2 sentence description

boundedContexts:
  - name: # name of first bounded context
    description: # brief 1-2 sentence description
    ports:
      in:
        - name: # name of inbound port
          type: # e.g. Repository, Service, Controller
          description: # brief 1-2 sentence description
      out:
        - name: # name of outbound port
          type: # e.g. Repository, Service, Gateway
          description: # brief 1-2 sentence description
    adapters:
      - name: # name of adapter
        type: Adapter
        implements: # name of port it implements
`;

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
        // Add template to description to guide LLM
        const enhancedDescription = `${description}\n\nPlease follow this exact YAML structure and ensure all entries have valid values:\n\n${TEMPLATE_YAML}`;
        const userPrompt = compileUserPrompt({
          userDescription: enhancedDescription,
        });
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

        // Validate the extracted YAML is actually parseable
        try {
          yaml.load(extractedYaml);
        } catch (yamlError) {
          const message =
            yamlError instanceof Error
              ? yamlError.message
              : "Invalid YAML structure";
          setGenerationError(`Generated manifest has invalid YAML: ${message}`);
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
