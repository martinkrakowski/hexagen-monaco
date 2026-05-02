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

const RETRY_SYSTEM_PROMPT = `You are a YAML code generator. Generate ONLY valid YAML. Follow these rules strictly:
- Every key must have a colon followed by a value on the SAME line
- Never leave a key without a value (e.g. "description" alone on a line is invalid)
- Use 2-space indentation consistently
- Do not truncate any values — complete every field
- Output ONLY the YAML, no markdown fences, no explanations`;

const RETRY_USER_TEMPLATE = `Generate a minimal but valid manifest.yaml for this project. Use at most 2 bounded contexts, at most 3 ports per context (1-2 in, 1 out), and 1-2 adapters per context. Complete every single field — no truncation.

Project: {description}

Output ONLY valid YAML starting with "workspace:". Example of correct syntax:
workspace:
  name: MyApp
  description: A sample application
boundedContexts:
  - name: core
    description: Core domain logic
    ports:
      in:
        - name: CreateItemPort
          type: Repository
          description: Creates a new item
      out:
        - name: NotificationPort
          type: Gateway
          description: Sends notifications
    adapters:
      - name: ItemRepositoryAdapter
        type: Adapter
        implements: CreateItemPort`;

function repairYaml(raw: string): string {
  let fixed = raw;
  fixed = fixed.replace(/^(\s+description)\s*$/gm, '$1: ""');
  fixed = fixed.replace(/^(\s+description):\s*$/gm, '$1: ""');
  fixed = fixed.replace(/^(\s+name)\s*$/gm, '$1: ""');
  fixed = fixed.replace(/^(\s+type)\s*$/gm, '$1: ""');
  fixed = fixed.replace(/^(\s+implements)\s*$/gm, '$1: ""');
  return fixed;
}

const MAX_RETRIES = 2;

export function useClientManifestGeneration(
  llmContext: LocalLLMContext,
): UseClientManifestGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(
    null,
  );

  const messageCountBeforeRef = useRef<number | null>(null);

  const attemptGeneration = async (
    description: string,
    isRetry: boolean,
    signal?: AbortSignal,
  ): Promise<{ yaml: string } | { error: string }> => {
    if (signal?.aborted) return { error: "Aborted" };

    const systemPrompt = isRetry ? RETRY_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const userPrompt = isRetry
      ? RETRY_USER_TEMPLATE.replace("{description}", description)
      : compileUserPrompt({ userDescription: description });

    await llmContext.sendGovernanceMessage(userPrompt, systemPrompt);

    if (signal?.aborted) return { error: "Aborted" };

    const messages = llmContext.messages;
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");

    const content = lastAssistantMessage?.content ?? "";

    if (!content) {
      return {
        error: "AI response did not contain a valid manifest YAML block",
      };
    }

    let extractedYaml = extractManifestYaml(content);

    if (!extractedYaml) {
      return {
        error: "AI response did not contain a valid manifest YAML block",
      };
    }

    try {
      yaml.load(extractedYaml);
    } catch {
      const repaired = repairYaml(extractedYaml);
      try {
        yaml.load(repaired);
        extractedYaml = repaired;
      } catch (yamlError) {
        const message =
          yamlError instanceof Error
            ? yamlError.message
            : "Invalid YAML structure";
        return { error: `Generated manifest has invalid YAML: ${message}` };
      }
    }

    return { yaml: extractedYaml };
  };

  const generateManifest = useCallback(
    async (description: string, signal?: AbortSignal) => {
      if (signal?.aborted) return;

      setGenerationError(null);
      setGeneratedManifest(null);
      setIsGenerating(true);

      const countBefore = llmContext.messages.length;
      messageCountBeforeRef.current = countBefore;

      try {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (signal?.aborted) {
            setIsGenerating(false);
            return;
          }

          const isRetry = attempt > 0;
          const result = await attemptGeneration(description, isRetry, signal);

          if ("yaml" in result) {
            setGeneratedManifest(result.yaml);
            setIsGenerating(false);
            return;
          }

          if (result.error === "Aborted") {
            setIsGenerating(false);
            return;
          }

          if (attempt < MAX_RETRIES) {
            continue;
          }

          setGenerationError(result.error);
          setIsGenerating(false);
          return;
        }
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
