"use client";

import { useState, useCallback, useRef } from "react";
import type { LocalLLMContext } from "../../lib/llm-interfaces";
import {
  ContextListSchema,
  PortsListSchema,
  normalizeDraft,
  normalizeTopologyDraft,
  validateDraft,
  checkClarificationTriggers,
  draftToManifest,
  renderDraft,
  parseJSON,
  normalizePortName,
  type ManifestDraft,
  type ManifestTopologyDraft,
  type ManifestTopologyDraftContext,
  type ContextListEntry,
  type PortsList,
  type ClarificationTrigger,
  type DraftDiagnostic,
} from "@hexagen/agentic-interaction";
import {
  CONTEXT_LIST_SYSTEM_PROMPT,
  compileContextListPrompt,
  PORTS_LIST_SYSTEM_PROMPT,
  compilePortsPrompt,
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
  return llmContext.sendStructuredPrompt(userPrompt, systemPrompt, signal);
}

async function attemptContextList(
  llmContext: LocalLLMContext,
  description: string,
  signal?: AbortSignal,
): Promise<
  { ok: true; contexts: ContextListEntry[] } | { ok: false; error: string }
> {
  const userPrompt = compileContextListPrompt({ userDescription: description });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };

    try {
      const content = await sendAndExtract(
        llmContext,
        userPrompt,
        CONTEXT_LIST_SYSTEM_PROMPT,
        signal,
      );
      if (!content) return { ok: false, error: "No response from LLM" };

      const parsed = parseJSON<ContextListEntry[]>(content);
      if (!parsed.ok) {
        if (attempt === MAX_RETRIES) return { ok: false, error: parsed.error };
        continue;
      }

      const result = ContextListSchema.safeParse(parsed.data);
      if (!result.success) {
        if (attempt === MAX_RETRIES) {
          const errors = result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          return { ok: false, error: `Context list validation: ${errors}` };
        }
        continue;
      }

      return { ok: true, contexts: result.data };
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  return { ok: false, error: "Failed to generate context list" };
}

async function attemptPortsForContext(
  llmContext: LocalLLMContext,
  contextName: string,
  contextDescription: string,
  contextType: string,
  signal?: AbortSignal,
): Promise<{ ok: true; ports: PortsList } | { ok: false; error: string }> {
  const userPrompt = compilePortsPrompt(
    contextName,
    contextDescription,
    contextType,
  );

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };

    try {
      const content = await sendAndExtract(
        llmContext,
        userPrompt,
        PORTS_LIST_SYSTEM_PROMPT,
        signal,
      );
      if (!content) return { ok: false, error: "No response from LLM" };

      const parsed = parseJSON<PortsList>(content);
      if (!parsed.ok) {
        if (attempt === MAX_RETRIES) return { ok: false, error: parsed.error };
        continue;
      }

      const result = PortsListSchema.safeParse(parsed.data);
      if (!result.success) {
        if (attempt === MAX_RETRIES) {
          const errors = result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          return {
            ok: false,
            error: `Ports validation for ${contextName}: ${errors}`,
          };
        }
        continue;
      }

      return { ok: true, ports: result.data };
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  return { ok: false, error: `Failed to generate ports for ${contextName}` };
}

async function buildTopologyViaMicroPasses(
  llmContext: LocalLLMContext,
  description: string,
  signal?: AbortSignal,
): Promise<
  { ok: true; topology: ManifestTopologyDraft } | { ok: false; error: string }
> {
  const workspaceName = description
    .slice(0, 60)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const workspace = {
    name: workspaceName || "generated-project",
    description: description.slice(0, 200),
  };

  const ctxResult = await attemptContextList(llmContext, description, signal);
  if (!ctxResult.ok) return { ok: false, error: ctxResult.error };

  const contexts: ManifestTopologyDraftContext[] = [];

  for (const ctx of ctxResult.contexts) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };

    const portsResult = await attemptPortsForContext(
      llmContext,
      ctx.name,
      ctx.description,
      ctx.type,
      signal,
    );

    if (!portsResult.ok) {
      return { ok: false, error: portsResult.error };
    }

    const inPorts = portsResult.ports.in.map(
      (p: { name: string; type: string; description: string }) => ({
        name: normalizePortName(p.name),
        type: p.type || "use-case",
        description:
          p.description || `Inbound port ${normalizePortName(p.name)}`,
      }),
    );

    const outPorts = portsResult.ports.out.map(
      (p: { name: string; type: string; description: string }) => ({
        name: normalizePortName(p.name),
        type: p.type || "infrastructure",
        description:
          p.description || `Outbound port ${normalizePortName(p.name)}`,
      }),
    );

    contexts.push({
      name: ctx.name,
      type: ctx.type,
      description: ctx.description,
      ports: {
        in: inPorts,
        out: outPorts,
      },
    });
  }

  const topology: ManifestTopologyDraft = {
    workspace,
    boundedContexts: contexts,
  };

  return { ok: true, topology: normalizeTopologyDraft(topology) };
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

      try {
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
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
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
        const topologyResult = await buildTopologyViaMicroPasses(
          llmContext,
          description,
          signal,
        );

        if (!topologyResult.ok) {
          setGenerationError(topologyResult.error);
          setPhase("failed");
          setIsGenerating(false);
          return;
        }

        const topology = topologyResult.topology;

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
    [llmContext],
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
