"use client";

import { useState, useCallback, useRef } from "react";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import {
  ManifestTopologyDraftSchema,
  normalizeDraft,
  normalizeTopologyDraft,
  validateDraft,
  checkClarificationTriggers,
  draftToManifest,
  renderDraft,
  parseJSON,
  type ManifestDraft,
  type ManifestTopologyDraft,
  type ClarificationTrigger,
  type DraftDiagnostic,
} from "@hexagen/agentic-interaction";
import {
  TOPOLOGY_SYSTEM_PROMPT,
  compileTopologyUserPrompt,
  ADAPTER_SYSTEM_PROMPT,
  compileAdapterUserPrompt,
} from "@hexagen/agentic-interaction";

const MAX_RETRIES = 2;

export type GenerationPhase =
  | "idle"
  | "topology"
  | "clarification_needed"
  | "adapters"
  | "rendering"
  | "complete"
  | "failed";

export interface UseClientManifestGenerationReturn {
  generateManifest: (
    description: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  isGenerating: boolean;
  generationError: string | null;
  generatedManifest: string | null;
  phase: GenerationPhase;
  clarificationTriggers: ClarificationTrigger[];
  partialTopology: ManifestTopologyDraft | null;
  confirmTopologyAndContinue: (signal?: AbortSignal) => Promise<void>;
  diagnostics: DraftDiagnostic[];
  reset: () => void;
}

async function sendAndExtract(
  llmContext: LocalLLMContext,
  userPrompt: string,
  systemPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  await llmContext.sendGovernanceMessage(userPrompt, systemPrompt);
  if (signal?.aborted) return "";

  const messages = llmContext.messages;
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  return lastAssistantMessage?.content ?? "";
}

export function useClientManifestGeneration(
  llmContext: LocalLLMContext,
): UseClientManifestGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedManifest, setGeneratedManifest] = useState<string | null>(
    null,
  );
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [clarificationTriggers, setClarificationTriggers] = useState<
    ClarificationTrigger[]
  >([]);
  const [partialTopology, setPartialTopology] =
    useState<ManifestTopologyDraft | null>(null);
  const [diagnostics, setDiagnostics] = useState<DraftDiagnostic[]>([]);

  const descriptionRef = useRef<string>("");

  const attemptTopologyExtraction = useCallback(
    async (
      description: string,
      validationErrors: string | undefined,
      signal?: AbortSignal,
    ): Promise<
      | { ok: true; topology: ManifestTopologyDraft }
      | { ok: false; error: string }
    > => {
      const userPrompt = compileTopologyUserPrompt({
        userDescription: description,
        validationErrors,
      });

      const content = await sendAndExtract(
        llmContext,
        userPrompt,
        TOPOLOGY_SYSTEM_PROMPT,
        signal,
      );
      if (!content) return { ok: false, error: "No response from LLM" };

      const parsed = parseJSON<ManifestTopologyDraft>(content);
      if (!parsed.ok) return { ok: false, error: parsed.error };

      const result = ManifestTopologyDraftSchema.safeParse(parsed.data);
      if (!result.success) {
        const errors = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return { ok: false, error: `Schema validation: ${errors}` };
      }

      return { ok: true, topology: normalizeTopologyDraft(result.data) };
    },
    [llmContext],
  );

  const attemptAdapterExtraction = useCallback(
    async (
      contextName: string,
      portNames: string[],
      validationErrors: string | undefined,
      signal?: AbortSignal,
    ): Promise<
      | {
          ok: true;
          adapters: ManifestDraft["boundedContexts"][number]["adapters"];
        }
      | { ok: false; error: string }
    > => {
      const userPrompt = compileAdapterUserPrompt({
        validatedPortInventory: portNames,
        contextName,
        validationErrors,
      });

      const content = await sendAndExtract(
        llmContext,
        userPrompt,
        ADAPTER_SYSTEM_PROMPT,
        signal,
      );
      if (!content) return { ok: false, error: "No response from LLM" };

      const parsed =
        parseJSON<ManifestDraft["boundedContexts"][number]["adapters"]>(
          content,
        );
      if (!parsed.ok) return { ok: false, error: parsed.error };

      return { ok: true, adapters: parsed.data };
    },
    [llmContext],
  );

  const generateManifest = useCallback(
    async (description: string, signal?: AbortSignal) => {
      if (signal?.aborted) return;

      setGenerationError(null);
      setGeneratedManifest(null);
      setPhase("topology");
      setIsGenerating(true);
      descriptionRef.current = description;

      try {
        let topology: ManifestTopologyDraft | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (signal?.aborted) {
            setIsGenerating(false);
            setPhase("idle");
            return;
          }

          const validationErrors =
            attempt > 0 && topology === null ? undefined : undefined;
          const result = await attemptTopologyExtraction(
            description,
            validationErrors,
            signal,
          );

          if (result.ok) {
            topology = result.topology;
            break;
          }

          if (attempt === MAX_RETRIES) {
            setGenerationError(result.error);
            setPhase("failed");
            setIsGenerating(false);
            return;
          }
        }

        if (!topology) {
          setGenerationError("Failed to generate topology");
          setPhase("failed");
          setIsGenerating(false);
          return;
        }

        const triggers = checkClarificationTriggers(topology);
        if (triggers.length > 0) {
          setClarificationTriggers(triggers);
          setPartialTopology(topology);
          setPhase("clarification_needed");
          setIsGenerating(false);
          return;
        }

        await finalizeGeneration(topology, signal);
      } catch (error) {
        if (signal?.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate manifest";
        setGenerationError(message);
        setPhase("failed");
        setIsGenerating(false);
      }
    },
    [attemptTopologyExtraction, llmContext],
  );

  const finalizeGeneration = useCallback(
    async (topology: ManifestTopologyDraft, signal?: AbortSignal) => {
      setPhase("adapters");

      const draftContexts: ManifestDraft["boundedContexts"] = [];

      for (const ctx of topology.boundedContexts) {
        if (signal?.aborted) {
          setIsGenerating(false);
          setPhase("idle");
          return;
        }

        const allPortNames = [
          ...ctx.ports.in.map((p: { name: string }) => p.name),
          ...ctx.ports.out.map((p: { name: string }) => p.name),
        ];

        let adapters: ManifestDraft["boundedContexts"][number]["adapters"] = [];

        if (allPortNames.length > 0) {
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (signal?.aborted) {
              setIsGenerating(false);
              setPhase("idle");
              return;
            }

            const result = await attemptAdapterExtraction(
              ctx.name,
              allPortNames,
              undefined,
              signal,
            );
            if (result.ok) {
              adapters = result.adapters;
              break;
            }

            if (attempt === MAX_RETRIES) {
              adapters = [];
              break;
            }
          }
        }

        draftContexts.push({
          name: ctx.name,
          type: ctx.type,
          description: ctx.description,
          ports: ctx.ports,
          adapters,
          dependsOn: ctx.dependsOn,
        });
      }

      setPhase("rendering");

      const draft: ManifestDraft = {
        workspace: topology.workspace,
        boundedContexts: draftContexts,
      };

      const normalized = normalizeDraft(draft);
      const validation = validateDraft(normalized);

      const manifest = draftToManifest(normalized);
      const rendered = await renderDraft(manifest, validation.diagnostics);

      setGeneratedManifest(rendered.yaml);
      setDiagnostics(rendered.diagnostics);
      setPhase("complete");
      setIsGenerating(false);
    },
    [attemptAdapterExtraction],
  );

  const confirmTopologyAndContinue = useCallback(
    async (signal?: AbortSignal) => {
      if (!partialTopology) return;
      setIsGenerating(true);
      try {
        await finalizeGeneration(partialTopology, signal);
      } catch (error) {
        if (signal?.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate manifest";
        setGenerationError(message);
        setPhase("failed");
        setIsGenerating(false);
      }
    },
    [partialTopology, finalizeGeneration],
  );

  const reset = useCallback(() => {
    setIsGenerating(false);
    setGenerationError(null);
    setGeneratedManifest(null);
    setPhase("idle");
    setClarificationTriggers([]);
    setPartialTopology(null);
    setDiagnostics([]);
  }, []);

  return {
    generateManifest,
    isGenerating,
    generationError,
    generatedManifest,
    phase,
    clarificationTriggers,
    partialTopology,
    confirmTopologyAndContinue,
    diagnostics,
    reset,
  };
}
