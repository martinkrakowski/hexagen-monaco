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
import { logger } from "../../lib/structured-logger";

// Coerce context type locally to handle empty strings and invalid types
const coerceContextType = (
  type: string,
): "core" | "supporting" | "driver" | "shared-kernel" => {
  const validTypes: readonly (
    | "core"
    | "supporting"
    | "driver"
    | "shared-kernel"
  )[] = ["core", "supporting", "driver", "shared-kernel"];
  const trimmed = (type ?? "").trim().toLowerCase();
  if (
    validTypes.includes(
      trimmed as "core" | "supporting" | "driver" | "shared-kernel",
    )
  ) {
    return trimmed as "core" | "supporting" | "driver" | "shared-kernel";
  }
  return "core";
};

const MAX_RETRIES = 2;

export type Port = {
  name: string;
  type: string;
  description: string;
};

export interface ManifestWarning {
  code: string;
  context?: string;
  message: string;
  severity: "warning";
}

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

/**
 * Normalizes a port from string or object format to a typed Port object.
 * Handles both direct string references and full object definitions.
 */
function normalizePort(input: unknown, defaultType: string): Port {
  if (typeof input === "string") {
    // String format: just a name
    return {
      name: input,
      type: defaultType,
      description: `Port ${input}`,
    };
  }

  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    if (typeof obj.name !== "string") {
      throw new Error(
        `Invalid port: missing or non-string name. Got: ${JSON.stringify(input)}`,
      );
    }
    return {
      name: obj.name,
      type: typeof obj.type === "string" ? obj.type : defaultType,
      description:
        typeof obj.description === "string"
          ? obj.description
          : `Port ${obj.name}`,
    };
  }

  throw new Error(
    `Invalid port format: expected string or object, got ${typeof input}. Full value: ${JSON.stringify(input)}`,
  );
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
      logger.info(`[manifest-gen] context-list phase, attempt=${attempt}`);
      const content = await sendAndExtract(
        llmContext,
        userPrompt,
        CONTEXT_LIST_SYSTEM_PROMPT,
        signal,
      );
      if (!content) {
        logger.error(`[manifest-gen] context-list: no response from LLM`);
        if (attempt === MAX_RETRIES)
          return { ok: false, error: "No response from LLM" };
        logger.info(
          `[manifest-gen] context-list: retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        continue;
      }

      const parsed =
        parseJSON<Array<{ name: string; type: string; description: string }>>(
          content,
        );
      if (!parsed.ok) {
        const errorMsg = "error" in parsed ? parsed.error : "Unknown error";
        logger.error(
          `[manifest-gen] context-list: JSON parse error: ${errorMsg}`,
        );
        if (attempt === MAX_RETRIES) {
          return { ok: false, error: errorMsg };
        }
        logger.info(
          `[manifest-gen] context-list: retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        continue;
      }

      // Apply runtime coercion: normalize types and fields
      const coercedContexts = parsed.data.map(
        (ctx: { name?: string; type?: string; description?: string }) => ({
          name: String(ctx.name || "unnamed-context").trim(),
          type: coerceContextType(String(ctx.type || "")),
          description: String(ctx.description || ctx.name || "").trim(),
        }),
      );

      const result = ContextListSchema.safeParse(coercedContexts);
      if (!result.success) {
        const errors = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.error(
          `[manifest-gen] context-list: validation error: ${errors}`,
        );
        if (attempt === MAX_RETRIES) {
          return { ok: false, error: `Context list validation: ${errors}` };
        }
        logger.info(
          `[manifest-gen] context-list: retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        continue;
      }

      logger.info(
        `[manifest-gen] context-list: successful, got ${result.data.length} contexts`,
      );
      return { ok: true, contexts: result.data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[manifest-gen] context-list: exception: ${errorMsg}`);
      if (attempt === MAX_RETRIES) {
        return { ok: false, error: errorMsg };
      }
      logger.info(
        `[manifest-gen] context-list: retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
    }
  }

  return { ok: false, error: "Failed to generate context list after retries" };
}

async function attemptPortsForContext(
  llmContext: LocalLLMContext,
  contextName: string,
  contextDescription: string,
  contextType: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; ports: PortsList; degraded?: boolean }
  | { ok: false; error: string }
> {
  const userPrompt = compilePortsPrompt(
    contextName,
    contextDescription,
    contextType,
  );

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };

    try {
      logger.info(
        `[manifest-gen] ports phase, attempt=${attempt}, context=${contextName}`,
      );
      const content = await sendAndExtract(
        llmContext,
        userPrompt,
        PORTS_LIST_SYSTEM_PROMPT,
        signal,
      );
      if (!content) {
        logger.error(
          `[manifest-gen] ports (${contextName}): no response from LLM`,
        );
        if (attempt === MAX_RETRIES) break;
        logger.info(
          `[manifest-gen] ports (${contextName}): retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        continue;
      }

      const parsed = parseJSON<PortsList>(content);
      if (!parsed.ok) {
        const errorMsg = "error" in parsed ? parsed.error : "Unknown error";
        logger.error(
          `[manifest-gen] ports (${contextName}): JSON parse error: ${errorMsg}`,
        );
        if (attempt === MAX_RETRIES) {
          break;
        }
        logger.info(
          `[manifest-gen] ports (${contextName}): retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        continue;
      }

      const result = PortsListSchema.safeParse(parsed.data);
      if (!result.success) {
        const errors = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.error(
          `[manifest-gen] ports (${contextName}): validation error: ${errors}`,
        );
        if (attempt === MAX_RETRIES) {
          break;
        }
        logger.info(
          `[manifest-gen] ports (${contextName}): retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        continue;
      }

      logger.info(
        `[manifest-gen] ports (${contextName}): successful, got ${result.data.in.length} in, ${result.data.out.length} out`,
      );
      return { ok: true, ports: result.data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `[manifest-gen] ports (${contextName}): exception: ${errorMsg}`,
      );
      if (attempt === MAX_RETRIES) {
        break;
      }
      logger.info(
        `[manifest-gen] ports (${contextName}): retrying (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
    }
  }

  logger.warn(
    `[manifest-gen] ports (${contextName}): all retries failed, using empty ports`,
  );
  return {
    ok: true,
    ports: { in: [], out: [] },
    degraded: true,
  };
}

async function buildTopologyViaMicroPasses(
  llmContext: LocalLLMContext,
  description: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; topology: ManifestTopologyDraft; warnings: ManifestWarning[] }
  | { ok: false; error: string }
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
  if (!ctxResult.ok) {
    const errorMsg = "error" in ctxResult ? ctxResult.error : "Unknown error";
    return { ok: false, error: errorMsg };
  }

  const contexts: ManifestTopologyDraftContext[] = [];
  const warnings: ManifestWarning[] = [];

  for (const ctx of ctxResult.contexts) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };

    logger.info(
      `[manifest-gen] Processing context: ${ctx.name}, type=${ctx.type}`,
    );
    const portsResult = await attemptPortsForContext(
      llmContext,
      ctx.name,
      ctx.description,
      ctx.type,
      signal,
    );

    if (portsResult.ok && portsResult.degraded) {
      warnings.push({
        code: "PORTS_EXTRACTION_FAILED",
        context: ctx.name,
        message: `Port extraction failed for ${ctx.name}, using empty ports`,
        severity: "warning",
      });
    }

    let inPorts: Port[];
    let outPorts: Port[];

    try {
      logger.info(`[manifest-gen] Normalizing inbound ports for ${ctx.name}`);
      inPorts = portsResult.ok
        ? portsResult.ports.in.map((p: unknown) => {
            const normalized = normalizePort(p, "use-case");
            return {
              ...normalized,
              name: normalizePortName(normalized.name),
            };
          })
        : [];
      logger.info(`[manifest-gen] Normalized ${inPorts.length} inbound ports`);
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : `Unknown error normalizing ports: ${String(error)}`;
      logger.error(
        `[manifest-gen] Failed to normalize inbound ports: ${errorMsg}`,
      );
      return { ok: false, error: errorMsg };
    }

    try {
      logger.info(`[manifest-gen] Normalizing outbound ports for ${ctx.name}`);
      outPorts = portsResult.ok
        ? portsResult.ports.out.map((p: unknown) => {
            const normalized = normalizePort(p, "infrastructure");
            return {
              ...normalized,
              name: normalizePortName(normalized.name),
            };
          })
        : [];
      logger.info(
        `[manifest-gen] Normalized ${outPorts.length} outbound ports`,
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : `Unknown error normalizing ports: ${String(error)}`;
      logger.error(
        `[manifest-gen] Failed to normalize outbound ports: ${errorMsg}`,
      );
      return { ok: false, error: errorMsg };
    }

    logger.info(
      `[manifest-gen] Context ${ctx.name}: ${inPorts.length} in, ${outPorts.length} out ports`,
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

  try {
    logger.info(
      `[manifest-gen] Finalizing topology with ${contexts.length} contexts`,
    );
    const normalizedTopology = normalizeTopologyDraft(topology);
    logger.info("[manifest-gen] Topology normalization successful");
    return { ok: true, topology: normalizedTopology, warnings };
  } catch (error) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : `Unknown error normalizing topology: ${String(error)}`;
    logger.error(`[manifest-gen] Topology normalization failed: ${errorMsg}`);
    return { ok: false, error: errorMsg };
  }
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
        if (!parsed.ok) {
          const errorMsg = "error" in parsed ? parsed.error : "Unknown error";
          return { ok: false, error: errorMsg };
        }

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
      if (signal?.aborted) {
        logger.info("[manifest-gen] Generation aborted before start");
        return;
      }

      logger.info(`[manifest-gen] Starting manifest generation`);
      setGenerationError(null);
      setGeneratedManifest(null);
      setPhase("topology");
      setIsGenerating(true);
      descriptionRef.current = description;

      try {
        logger.info(
          `[manifest-gen] Building topology from description: "${description.slice(0, 100)}..."`,
        );
        const topologyResult = await buildTopologyViaMicroPasses(
          llmContext,
          description,
          signal,
        );

        if (!topologyResult.ok) {
          const errorMsg =
            "error" in topologyResult ? topologyResult.error : "Unknown error";
          logger.error(`[manifest-gen] Topology build failed: ${errorMsg}`);
          setGenerationError(errorMsg);
          setPhase("failed");
          setIsGenerating(false);
          return;
        }

        const topology = topologyResult.topology;

        const triggers = checkClarificationTriggers(topology);
        if (triggers.length > 0) {
          logger.info(
            `[manifest-gen] Clarification needed for ${triggers.length} issue(s)`,
          );
          setClarificationTriggers(triggers);
          setPartialTopology(topology);
          setPhase("clarification_needed");
          setIsGenerating(false);
          return;
        }

        if (topologyResult.warnings.length > 0) {
          logger.warn(
            `[manifest-gen] Topology generation completed with ${topologyResult.warnings.length} warning(s)`,
          );
        }

        logger.info(
          `[manifest-gen] Topology generation successful, proceeding to finalize`,
        );
        await finalizeGeneration(topology, signal, topologyResult.warnings);
      } catch (error) {
        if (signal?.aborted) {
          logger.info("[manifest-gen] Generation aborted");
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate manifest";
        logger.error(`[manifest-gen] Manifest generation failed: ${message}`);
        setGenerationError(message);
        setPhase("failed");
        setIsGenerating(false);
      }
    },
    [llmContext],
  );

  const finalizeGeneration = useCallback(
    async (
      topology: ManifestTopologyDraft,
      signal?: AbortSignal,
      warnings: ManifestWarning[] = [],
    ) => {
      logger.info(
        `[manifest-gen] Finalizing generation for ${topology.boundedContexts.length} contexts`,
      );
      setPhase("adapters");

      const draftContexts: ManifestDraft["boundedContexts"] = [];

      for (const ctx of topology.boundedContexts) {
        if (signal?.aborted) {
          logger.info("[manifest-gen] Finalization aborted");
          setIsGenerating(false);
          setPhase("idle");
          return;
        }

        logger.info(
          `[manifest-gen] Processing adapters for context: ${ctx.name}`,
        );

        const allPortNames = [
          ...ctx.ports.in.map((p: { name: string }) => p.name),
          ...ctx.ports.out.map((p: { name: string }) => p.name),
        ];

        let adapters: ManifestDraft["boundedContexts"][number]["adapters"] = [];

        if (allPortNames.length > 0) {
          logger.info(
            `[manifest-gen] Extracting adapters for ${allPortNames.length} ports`,
          );
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (signal?.aborted) {
              logger.info("[manifest-gen] Finalization aborted");
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
              logger.info(
                `[manifest-gen] Got ${adapters.length} adapters for ${ctx.name}`,
              );
              break;
            }

            if (attempt === MAX_RETRIES) {
              logger.warn(
                `[manifest-gen] Failed to extract adapters after ${MAX_RETRIES + 1} attempts, continuing with empty adapters`,
              );
              adapters = [];
              break;
            }

            logger.info(
              `[manifest-gen] Adapter extraction retry ${attempt + 1}/${MAX_RETRIES}`,
            );
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
      logger.info("[manifest-gen] Rendering manifest to YAML");

      const draft: ManifestDraft = {
        workspace: topology.workspace,
        boundedContexts: draftContexts,
      };

      const normalized = normalizeDraft(draft);
      const validation = validateDraft(normalized);

      const manifest = draftToManifest(normalized);
      const rendered = await renderDraft(manifest, validation.diagnostics);

      logger.info(
        `[manifest-gen] Manifest rendering complete, ${rendered.diagnostics.length} diagnostic(s)`,
      );
      setGeneratedManifest(rendered.yaml);
      setDiagnostics([
        ...rendered.diagnostics,
        ...warnings.map((w) => ({
          code: w.code,
          message: w.message,
          severity: "warning" as const,
          context: w.context,
        })),
      ]);
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
