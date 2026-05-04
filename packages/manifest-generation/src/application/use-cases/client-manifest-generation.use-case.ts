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
  extractArrayFromWrapper,
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
            } else if (
              typeof parsed.data === "object" &&
              parsed.data !== null
            ) {
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
