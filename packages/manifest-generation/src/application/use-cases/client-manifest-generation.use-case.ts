import type {
  ManifestTopologyDraft,
  ManifestDraft,
  ClarificationTrigger,
  DraftDiagnostic,
  ManifestDraftContext,
} from "@hexagen/agentic-interaction";
import {
  normalizeDraft,
  normalizeTopologyDraft,
  validateDraft,
  checkClarificationTriggers,
  draftToManifest,
  renderDraft,
  parseJSON,
  normalizePortName,
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
import { attemptContextList, MAX_RETRIES } from "./context-list-extractor.js";
import { attemptPortsForContext, normalizePort } from "./ports-extractor.js";
import type { Port } from "./ports-extractor.js";

export class ClientManifestGenerationUseCase implements ClientManifestGenerationPort {
  constructor(private readonly messagingPort: LocalLlmMessagingPort) {}

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

      if (portsResult.ok && portsResult.ports) {
        try {
          inPorts = (portsResult.ports.in ?? []).map((p: unknown) => {
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
          outPorts = (portsResult.ports.out ?? []).map((p: unknown) => {
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
        ...(ctx.ports?.in ?? []).map((p: { name: string }) => p.name),
        ...(ctx.ports?.out ?? []).map((p: { name: string }) => p.name),
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

            // Try parsing as full JSON first (array or object wrapper)
            let extracted: unknown[] = [];
            const fullParsed = parseJSON<unknown>(content);

            if (fullParsed.ok) {
              const data = fullParsed.data;
              if (Array.isArray(data)) {
                extracted = data;
              } else if (typeof data === "object" && data !== null) {
                const obj = data as Record<string, unknown>;
                for (const key of [
                  "adapters",
                  "data",
                  "items",
                  "results",
                  "list",
                ]) {
                  if (Array.isArray(obj[key])) {
                    extracted = obj[key] as unknown[];
                    break;
                  }
                }
                if (
                  extracted.length === 0 &&
                  ("name" in obj || "adapterName" in obj || "implements" in obj)
                ) {
                  extracted = [data];
                }
              }
            }

            // Fallback: parse as NDJSON (one object per line)
            if (extracted.length === 0) {
              const lines = content
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.length > 0);

              for (const line of lines) {
                const lineParsed = parseJSON<Record<string, unknown>>(line);
                if (lineParsed.ok) {
                  extracted.push(lineParsed.data);
                }
              }
            }

            if (extracted.length > 0) {
              adapters = extracted
                .map((item) => {
                  if (typeof item !== "object" || item === null) return null;
                  const obj = item as Record<string, unknown>;
                  // Normalize: adapterName → name
                  const resolvedName =
                    (obj.name as string) || (obj.adapterName as string) || "";
                  return {
                    ...obj,
                    name: resolvedName,
                  };
                })
                .filter(
                  (item): item is Record<string, unknown> & { name: string } =>
                    item !== null &&
                    typeof item.name === "string" &&
                    item.name.length > 0,
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

  checkClarificationTriggers(
    topology: ManifestTopologyDraft,
  ): ClarificationTrigger[] {
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
