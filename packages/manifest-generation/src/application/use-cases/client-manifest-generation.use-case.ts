import type { ZodSchema } from "zod";
import type {
  ManifestTopologyDraft,
  ManifestDraft,
  ClarificationTrigger,
  DraftDiagnostic,
  ContextListEntry,
  PortsList,
  ManifestDraftContext,
} from "@hexagen/agentic-interaction";
import {
  createContextListSchema,
  PortsListSchema,
  normalizeDraft,
  normalizeTopologyDraft,
  validateDraft,
  checkClarificationTriggers,
  draftToManifest,
  renderDraft,
  parseJSON,
  extractArrayFromWrapper,
  extractObjectFromWrapper,
  coerceRawPorts,
  coerceContextType,
  coercePort,
  normalizePortName,
  CONTEXT_LIST_SYSTEM_PROMPT,
  compileContextListPrompt,
  PORTS_LIST_SYSTEM_PROMPT,
  compilePortsPrompt,
  ADAPTER_SYSTEM_PROMPT,
  compileAdapterUserPrompt,
} from "@hexagen/agentic-interaction";
import type { ClientManifestGenerationPort } from "../ports/in/client-manifest-generation.port.js";
import type {
  ClientManifestGenerationInput,
  ClientManifestGenerationResult,
  ClientManifestGenerationAdaptersPhaseResult,
} from "../ports/in/client-manifest-generation.port.js";
import type { LocalLlmMessagingPort } from "../ports/out/local-llm-messaging.port.js";
import { deriveWorkspaceName } from "../../domain/value-objects/workspace-name-deriver.js";

const MAX_RETRIES = 2;

interface Port {
  name: string;
  type: string;
  description: string;
}

function normalizePort(input: unknown, defaultType: string): Port {
  if (typeof input === "string") {
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
  messagingPort: LocalLlmMessagingPort,
  description: string,
  signal?: AbortSignal,
  onStepDetail?: (detail: string) => void,
  maxContexts?: number,
): Promise<
  { ok: true; contexts: ContextListEntry[] } | { ok: false; error: string }
> {
  const userPrompt = compileContextListPrompt({ userDescription: description });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };

    try {
      onStepDetail?.(
        `Identifying bounded contexts${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}...`,
      );
      const content = await messagingPort.sendStructuredPrompt(
        userPrompt,
        CONTEXT_LIST_SYSTEM_PROMPT,
        signal,
      );
      if (!content) {
        if (attempt === MAX_RETRIES)
          return { ok: false, error: "No response from LLM" };
        continue;
      }

      const parsed =
        parseJSON<Array<{ name: string; type: string; description: string }>>(
          content,
        );
      if (!parsed.ok) {
        const errorMsg = "error" in parsed ? parsed.error : "Unknown error";
        if (attempt === MAX_RETRIES) {
          return { ok: false, error: errorMsg };
        }
        continue;
      }

      const rawContexts = extractArrayFromWrapper<{
        name?: string;
        type?: string;
        description?: string;
      }>(parsed.data, ["contexts", "data", "items", "results", "list"]);

      if (rawContexts.length === 0 && !Array.isArray(parsed.data)) {
        const errorMsg = `Context list: expected array but got object with keys: ${Object.keys(parsed.data as object).join(", ")}`;
        if (attempt === MAX_RETRIES) {
          return { ok: false, error: errorMsg };
        }
        continue;
      }

      const coercedContexts = rawContexts.map(
        (ctx: { name?: string; type?: string; description?: string }) => ({
          name: String(ctx.name || "unnamed-context").trim(),
          type: coerceContextType(String(ctx.type || "")),
          description: String(ctx.description || ctx.name || "").trim(),
        }),
      );

      const result =
        createContextListSchema(maxContexts).safeParse(coercedContexts);
      if (!result.success) {
        const errors = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        if (attempt === MAX_RETRIES) {
          return { ok: false, error: `Context list validation: ${errors}` };
        }
        continue;
      }

      onStepDetail?.(`Found ${result.data.length} bounded contexts`);
      return { ok: true, contexts: result.data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_RETRIES) {
        return { ok: false, error: errorMsg };
      }
    }
  }

  return { ok: false, error: "Failed to generate context list after retries" };
}

async function attemptPortsForContext(
  messagingPort: LocalLlmMessagingPort,
  contextName: string,
  contextDescription: string,
  contextType: string,
  signal?: AbortSignal,
  onStepDetail?: (detail: string) => void,
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
      onStepDetail?.(
        `Extracting ports for ${contextName}${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}...`,
      );
      const content = await messagingPort.sendStructuredPrompt(
        userPrompt,
        PORTS_LIST_SYSTEM_PROMPT,
        signal,
      );
      if (!content) {
        if (attempt === MAX_RETRIES) break;
        continue;
      }

      const parsed = parseJSON<PortsList>(content);
      if (!parsed.ok) {
        if (attempt === MAX_RETRIES) break;
        continue;
      }

      let portsData = parsed.data;
      if (
        !Array.isArray(portsData) &&
        typeof portsData === "object" &&
        portsData !== null
      ) {
        const obj = portsData as Record<string, unknown>;
        if (typeof obj.in === "undefined" && typeof obj.out === "undefined") {
          const unwrapped = extractObjectFromWrapper<Record<string, unknown>>(
            portsData,
            ["ports", "data", "result"],
          );
          if (unwrapped) {
            portsData = unwrapped as PortsList;
          }
        }
      }

      const coerced = coerceRawPorts(portsData);
      portsData = { in: coerced.in, out: coerced.out };

      const result = PortsListSchema.safeParse(portsData);
      if (!result.success) {
        if (attempt === MAX_RETRIES) break;
        continue;
      }

      onStepDetail?.(
        `${contextName}: ${result.data.in.length} inbound, ${result.data.out.length} outbound ports`,
      );
      return { ok: true, ports: result.data };
    } catch (error) {
      if (attempt === MAX_RETRIES) break;
    }
  }

  return {
    ok: true,
    ports: { in: [], out: [] },
    degraded: true,
  };
}

export class ClientManifestGenerationUseCase implements ClientManifestGenerationPort {
  constructor(
    private readonly messagingPort: LocalLlmMessagingPort,
  ) {}

  async generateTopology(
    input: ClientManifestGenerationInput,
    signal?: AbortSignal,
    onStepDetail?: (detail: string) => void,
  ): Promise<ClientManifestGenerationResult> {
    const { description, maxContexts } = input;

    const { name: workspaceName, description: workspaceDescription } =
      deriveWorkspaceName(description);

    const ctxResult = await attemptContextList(
      this.messagingPort,
      description,
      signal,
      onStepDetail,
      maxContexts,
    );
    if (!ctxResult.ok) {
      return { ok: false, error: ctxResult.error };
    }

    const contexts: ManifestTopologyDraft["boundedContexts"] = [];

    for (const ctx of ctxResult.contexts) {
      if (signal?.aborted) return { ok: false, error: "Aborted" };

      onStepDetail?.(`Processing ${ctx.name} (${ctx.type})...`);
      const portsResult = await attemptPortsForContext(
        this.messagingPort,
        ctx.name,
        ctx.description,
        ctx.type,
        signal,
        onStepDetail,
      );

      let inPorts: Port[] = [];
      let outPorts: Port[] = [];

      if (portsResult.ok) {
        try {
          inPorts = portsResult.ports.in.map((p: unknown) => {
            const normalized = normalizePort(p, "use-case");
            return {
              ...normalized,
              name: normalizePortName(normalized.name),
            };
          });
        } catch {
          // Use empty array on error
        }

        try {
          outPorts = portsResult.ports.out.map((p: unknown) => {
            const normalized = normalizePort(p, "infrastructure");
            return {
              ...normalized,
              name: normalizePortName(normalized.name),
            };
          });
        } catch {
          // Use empty array on error
        }
      }

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
      workspace: {
        name: workspaceName,
        description: workspaceDescription,
      },
      boundedContexts: contexts,
    };

    const normalizedTopology = normalizeTopologyDraft(topology);

    return {
      ok: true,
      topology: normalizedTopology,
      warnings: [],
    };
  }

  async extractAdapters(
    topology: ManifestTopologyDraft,
    signal?: AbortSignal,
    onStepDetail?: (detail: string) => void,
  ): Promise<ClientManifestGenerationAdaptersPhaseResult> {
    const draftContexts: ManifestDraft["boundedContexts"] = [];

    for (const ctx of topology.boundedContexts) {
      if (signal?.aborted) {
        return { ok: false, error: "Aborted" };
      }

      onStepDetail?.(`Extracting adapters for ${ctx.name}...`);

      const allPortNames = [
        ...ctx.ports.in.map((p: { name: string }) => p.name),
        ...ctx.ports.out.map((p: { name: string }) => p.name),
      ];

      let adapters: ManifestDraftContext["adapters"] = [];

      if (allPortNames.length > 0) {
        onStepDetail?.(
          `Extracting ${allPortNames.length} adapters for ${ctx.name}...`,
        );

        const userPrompt = compileAdapterUserPrompt({
          validatedPortInventory: allPortNames,
          contextName: ctx.name,
          validationErrors: undefined,
        });

        let success = false;
        for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
          if (signal?.aborted) {
            return { ok: false, error: "Aborted" };
          }

          try {
            const content = await this.messagingPort.sendStructuredPrompt(
              userPrompt,
              ADAPTER_SYSTEM_PROMPT,
              signal,
            );
            if (!content) {
              if (attempt === MAX_RETRIES) break;
              continue;
            }

            const parsed = parseJSON<ManifestDraftContext["adapters"]>(content);
            if (!parsed.ok) {
              if (attempt === MAX_RETRIES) break;
              continue;
            }

            let extracted: unknown[] | null = null;

            if (Array.isArray(parsed.data)) {
              extracted = parsed.data;
            } else if (typeof parsed.data === "object" && parsed.data !== null) {
              extracted = extractArrayFromWrapper(parsed.data, [
                "adapters",
                "data",
                "items",
                "result",
              ]);
              if (extracted.length === 0) {
                if (
                  "name" in (parsed.data as Record<string, unknown>) ||
                  "implements" in (parsed.data as Record<string, unknown>)
                ) {
                  extracted = [parsed.data];
                }
              }
            }

            if (extracted) {
              adapters = extracted.filter(
                (item): item is Record<string, unknown> =>
                  typeof item === "object" &&
                  item !== null &&
                  typeof (item as Record<string, unknown>).name === "string",
              ) as ManifestDraftContext["adapters"];
              success = true;
            }
          } catch {
            if (attempt === MAX_RETRIES) break;
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

    const draft: ManifestDraft = {
      workspace: topology.workspace,
      boundedContexts: draftContexts,
    };

    const normalized = normalizeDraft(draft);
    const validation = validateDraft(normalized);

    return {
      ok: true,
      draft: normalized,
      diagnostics: validation.diagnostics,
    };
  }

  checkClarificationTriggers(topology: ManifestTopologyDraft): ClarificationTrigger[] {
    return checkClarificationTriggers(topology);
  }

  async renderManifest(
    draft: ManifestDraft,
    signal?: AbortSignal,
  ): Promise<{ yaml: string; diagnostics: DraftDiagnostic[] }> {
    const manifest = draftToManifest(draft);
    const rendered = await renderDraft(manifest, []);
    return rendered;
  }
}
